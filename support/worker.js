// Farm Hop supporters (Cloudflare Worker + KV).
//
// "Become a Hop Supporter" in the game's Settings gives the player a code like
// HOP-7KQ3MX. The main way to pay is a Stripe Payment Link, which the game opens with
// the code built in (?client_reference_id=HOP-7KQ3MX), so there's nothing to type.
// Or on Ko-fi, where the player pastes the code into their message. Either way the
// payment comes here, and the game (asking every few seconds) unlocks.
//
//   POST /stripe            Stripe's webhook (checkout.session.completed), signed
//                           with the STRIPE_WEBHOOK_SECRET secret.
//   POST /kofi              Ko-fi's webhook (form field "data", JSON). Checked
//                           against the KOFI_TOKEN secret.
//   GET  /check?code=...    {"paid": true|false}
//   POST /restore           {"email": "..."} -> {"code": "..."} for someone who has
//                           supported: their code back, or a new one if they never
//                           pasted one into the message.
//   GET  /admin             A small page listing supporters (needs ADMIN_KEY), with a
//   POST /admin/list          button to give someone a code by hand.
//   POST /admin/issue
//   POST /admin/gift        A free code: for family, friends, and trying it out.
//
// KV keys: pay:<time>:<transaction> = the payment (no email, just its hash),
// code:<CODE> = { tx, at }, email:<sha-256 of the email> = { tx, code }.

const ALLOWED_ORIGINS = [
  "https://farmhop.fun",
  "https://www.farmhop.fun",
  // Local development / testing only -- safe to remove for production.
  "http://localhost:5520",
];
const MIN_AMOUNT = 5;                                   // in the page's currency (USD)
const CODE_ABC = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";       // the same letters the game uses
const CODE_IN_TEXT = /HOP[\s-]?([A-HJKMNP-Z2-9]{6})(?![A-Z0-9])/i;
const CODE_PATTERN = /^HOP-[A-HJKMNP-Z2-9]{6}$/;

const json = (body, status = 200, headers = {}) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json", ...headers } });

function cors(request) {
  const origin = request.headers.get("origin");
  if (!ALLOWED_ORIGINS.includes(origin)) return {};
  return { "access-control-allow-origin": origin, "access-control-allow-methods": "GET, POST", "access-control-allow-headers": "content-type, authorization", vary: "origin" };
}

async function sha256(text) {
  const d = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text.trim().toLowerCase()));
  return [...new Uint8Array(d)].map(b => b.toString(16).padStart(2, "0")).join("");
}

function newCode() {
  const r = crypto.getRandomValues(new Uint8Array(6));
  return "HOP-" + [...r].map(b => CODE_ABC[b % CODE_ABC.length]).join("");
}

function sameText(a, b) {   // compares secrets without stopping at the first difference
  if (typeof a !== "string" || typeof b !== "string" || a.length !== b.length) return false;
  let d = 0;
  for (let i = 0; i < a.length; i++) d |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return d === 0;
}

// A payment, from Stripe or Ko-fi: mark its code paid and remember it.
async function record(env, p) {
  if (await env.SUPPORT.get("tx:" + p.tx)) return;                     // sent to us already
  const enough = p.amount >= MIN_AMOUNT;
  let code = CODE_PATTERN.test(p.code) ? p.code : null;
  if (code && await env.SUPPORT.get("code:" + code)) code = null;      // already used by an earlier payment
  const tx = p.tx, at = p.at;
  const emailHash = p.email ? await sha256(p.email) : null, payKey = `pay:${at}:${tx}`;
  if (enough && code) await env.SUPPORT.put("code:" + code, JSON.stringify({ tx, at }));
  if (enough && emailHash) {
    const old = JSON.parse(await env.SUPPORT.get("email:" + emailHash) || "null");
    await env.SUPPORT.put("email:" + emailHash, JSON.stringify({ tx, payKey, code: code || old?.code || null }));
  }
  await env.SUPPORT.put("tx:" + tx, "1");
  await env.SUPPORT.put(payKey, JSON.stringify({
    tx, at, enough, code, emailHash, via: p.via,
    name: String(p.name || "").slice(0, 80), amount: p.amount.toFixed(2), currency: String(p.currency || "").toUpperCase(),
    type: String(p.type || ""), message: String(p.message || "").slice(0, 300),
  }));
}

// Stripe: a Payment Link checkout finished. The signature is an HMAC of
// "<timestamp>.<body>" with the endpoint's signing secret (Stripe-Signature header).
async function stripe(request, env) {
  const body = await request.text(), sig = request.headers.get("stripe-signature") || "";
  const parts = Object.fromEntries(sig.split(",").map(kv => kv.split("=")).filter(kv => kv.length === 2 && kv[0] !== "v1"));
  const sigs = sig.split(",").filter(kv => kv.startsWith("v1=")).map(kv => kv.slice(3));
  const t = parseInt(parts.t, 10);
  if (!env.STRIPE_WEBHOOK_SECRET || !t || !sigs.length || Math.abs(Date.now() / 1000 - t) > 300) return new Response("forbidden", { status: 403 });
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(env.STRIPE_WEBHOOK_SECRET), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const mac = new Uint8Array(await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(`${t}.${body}`)));
  const want = [...mac].map(b => b.toString(16).padStart(2, "0")).join("");
  if (!sigs.some(s => sameText(s, want))) return new Response("forbidden", { status: 403 });
  let event;
  try { event = JSON.parse(body); } catch { return new Response("bad request", { status: 400 }); }
  const s = event.data?.object;
  const done = event.type === "checkout.session.completed" || event.type === "checkout.session.async_payment_succeeded";
  if (!done || !s || s.payment_status !== "paid") return new Response("ok");   // not a finished payment: nothing to do
  await record(env, {
    via: "stripe", tx: String(s.id).slice(0, 80), at: new Date((s.created || t) * 1000).toISOString(),
    amount: (s.amount_total || 0) / 100, currency: s.currency, code: String(s.client_reference_id || "").toUpperCase(),
    email: s.customer_details?.email, name: s.customer_details?.name, type: "Card",
  });
  return new Response("ok");
}

// Ko-fi: a payment came in.
async function kofi(request, env) {
  let data;
  try {
    const form = await request.formData();
    data = JSON.parse(form.get("data"));
  } catch {
    return new Response("bad request", { status: 400 });
  }
  if (!env.KOFI_TOKEN || !sameText(data.verification_token, env.KOFI_TOKEN)) return new Response("forbidden", { status: 403 });
  const found = String(data.message || "").match(CODE_IN_TEXT);
  await record(env, {
    via: "kofi", tx: String(data.kofi_transaction_id || data.message_id || crypto.randomUUID()).slice(0, 80),
    at: new Date(data.timestamp || Date.now()).toISOString(), amount: parseFloat(data.amount) || 0, currency: data.currency,
    code: found ? "HOP-" + found[1].toUpperCase() : null, email: data.email, name: data.from_name, type: data.type, message: data.message,
  });
  return new Response("ok");
}

async function check(url, env, headers) {
  const code = (url.searchParams.get("code") || "").toUpperCase();
  if (!CODE_PATTERN.test(code)) return json({ paid: false }, 200, headers);
  return json({ paid: !!(await env.SUPPORT.get("code:" + code)) }, 200, headers);
}

// Someone has supported but lost their code (a new phone, cleared Safari): by email.
async function restore(request, env, headers) {
  let email = "";
  try { email = String((await request.json()).email || ""); } catch {}
  if (!email.includes("@") || email.length > 200) return json({ error: "email" }, 400, headers);
  const key = "email:" + await sha256(email);
  const rec = JSON.parse(await env.SUPPORT.get(key) || "null");
  if (!rec) return json({ error: "notFound" }, 404, headers);
  if (rec.code) return json({ code: rec.code }, 200, headers);
  const code = await giveCode(env, rec.tx);
  await env.SUPPORT.put(key, JSON.stringify({ ...rec, code }));
  const pay = rec.payKey && JSON.parse(await env.SUPPORT.get(rec.payKey) || "null");
  if (pay) await env.SUPPORT.put(rec.payKey, JSON.stringify({ ...pay, code }));   // the admin page shows it has one now
  return json({ code }, 200, headers);
}

async function giveCode(env, tx) {
  let code = newCode();
  while (await env.SUPPORT.get("code:" + code)) code = newCode();
  await env.SUPPORT.put("code:" + code, JSON.stringify({ tx, at: new Date().toISOString(), byHand: true }));
  return code;
}

// ---- the admin page ----
const isAdmin = (request, env) => !!env.ADMIN_KEY && sameText((request.headers.get("authorization") || "").replace(/^Bearer /, ""), env.ADMIN_KEY);

async function adminList(env) {
  const out = [];
  let cursor;
  do {
    const page = await env.SUPPORT.list({ prefix: "pay:", cursor });
    for (const k of page.keys) out.push(JSON.parse(await env.SUPPORT.get(k.name)));
    cursor = page.list_complete ? null : page.cursor;
  } while (cursor && out.length < 500);
  return out.reverse();                                   // newest first
}

async function adminGift(request, env) {
  let name = "";
  try { name = String((await request.json()).name || "").slice(0, 80); } catch {}
  const at = new Date().toISOString(), tx = "gift-" + crypto.randomUUID().slice(0, 8);
  const code = await giveCode(env, tx);
  await env.SUPPORT.put(`pay:${at}:${tx}`, JSON.stringify({ tx, at, enough: true, code, emailHash: null, name, amount: "0", currency: "", type: "Gift", message: "" }));
  return json({ code });
}

async function adminIssue(request, env) {
  const { tx } = await request.json();
  const list = await env.SUPPORT.list({ prefix: "pay:" });
  const k = list.keys.find(k => k.name.endsWith(":" + tx));
  if (!k) return json({ error: "notFound" }, 404);
  const rec = JSON.parse(await env.SUPPORT.get(k.name));
  const code = await giveCode(env, tx);
  rec.code = code;
  await env.SUPPORT.put(k.name, JSON.stringify(rec));
  if (rec.emailHash) await env.SUPPORT.put("email:" + rec.emailHash, JSON.stringify({ tx, payKey: k.name, code }));
  return json({ code });
}

const ADMIN_PAGE = `<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Hop Supporters</title>
<style>body{font:15px system-ui,sans-serif;margin:16px;background:#fff8ec;color:#3a2442}table{border-collapse:collapse;width:100%}
td,th{padding:6px 8px;border-bottom:1px solid #e5d6c0;text-align:left;vertical-align:top}button{font:inherit;padding:4px 10px}
input{font:inherit;padding:6px;width:min(320px,100%)}.no{color:#a33}</style>
<h1>Hop Supporters</h1>
<form id="f"><input id="k" type="password" placeholder="Admin key" autocomplete="current-password"> <button>Show</button></form>
<p id="s"></p><p id="g" hidden><input id="gn" placeholder="Who is it for?"> <button id="gb">Make a gift code</button></p><table id="t"></table>
<script>
let key = '';
const s = document.getElementById('s'), t = document.getElementById('t');
const call = (path, body) => fetch(path, { method: 'POST', headers: { authorization: 'Bearer ' + key, 'content-type': 'application/json' }, body: JSON.stringify(body || {}) });
async function load() {
  const r = await call('/admin/list');
  if (!r.ok) { s.textContent = 'Wrong key.'; return; }
  const rows = await r.json();
  s.textContent = rows.length + ' payments';
  document.getElementById('g').hidden = false;
  t.innerHTML = '<tr><th>When</th><th>Who</th><th>Amount</th><th>Code</th><th>Message</th></tr>';
  for (const p of rows) {
    const tr = t.insertRow();
    for (const v of [p.at.slice(0, 16).replace('T', ' '), p.name, p.amount + ' ' + p.currency + (p.via ? ' · ' + (p.via === 'stripe' ? 'card' : 'Ko-fi') : '') + (p.enough ? '' : ' (under $5)')]) tr.insertCell().textContent = v;
    const c = tr.insertCell();
    if (p.code) c.textContent = p.code + (p.enough ? '' : ' (not unlocked)');
    else { const b = document.createElement('button'); b.textContent = 'Give a code'; b.onclick = async () => { const r = await call('/admin/issue', { tx: p.tx }); if (r.ok) load(); }; c.append(b); }
    tr.insertCell().textContent = p.message;
  }
}
document.getElementById('gb').onclick = async () => { const r = await call('/admin/gift', { name: document.getElementById('gn').value }); if (r.ok) { s.textContent = 'Gift code: ' + (await r.json()).code; load(); } };
document.getElementById('f').onsubmit = e => { e.preventDefault(); key = document.getElementById('k').value; load(); };
</script>`;

export default {
  async fetch(request, env) {
    const url = new URL(request.url), headers = cors(request);
    if (request.method === "OPTIONS") return new Response(null, { status: 204, headers });
    try {
      if (url.pathname === "/kofi" && request.method === "POST") return await kofi(request, env);
      if (url.pathname === "/stripe" && request.method === "POST") return await stripe(request, env);
      if (url.pathname === "/check" && request.method === "GET") return await check(url, env, headers);
      if (url.pathname === "/restore" && request.method === "POST") return await restore(request, env, headers);
      if (url.pathname === "/admin" && request.method === "GET") return new Response(ADMIN_PAGE, { headers: { "content-type": "text/html; charset=utf-8" } });
      if (url.pathname.startsWith("/admin/") && request.method === "POST") {
        if (!isAdmin(request, env)) return json({ error: "key" }, 403);
        if (url.pathname === "/admin/list") return json(await adminList(env));
        if (url.pathname === "/admin/issue") return await adminIssue(request, env);
        if (url.pathname === "/admin/gift") return await adminGift(request, env);
      }
    } catch (e) {
      return json({ error: "server" }, 500, headers);
    }
    return new Response("Farm Hop supporters", { status: 404 });
  },
};
