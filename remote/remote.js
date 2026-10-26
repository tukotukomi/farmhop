// Farm Hop Jam: a phone that joins the Jam Stage on a TV or computer.
// Scanning the QR code there opens this page with the room in the link
// (#r=<room>). It connects to the relay (../relay/) as a player, picks a hopper
// the farm has, and becomes that hopper's synth pads. Every note plays on the
// TV, so everyone hears the same jam along with the soundtrack.
import { STRINGS } from '../lang.js';

const $ = id => document.getElementById(id);
const params = new URLSearchParams(location.hash.slice(1));
const room = params.get('r');
const relay = params.get('relay') || window.FARMHOP_RELAY_URL;   // relay= only for local testing

// Language: this phone's own choice if it has played Farm Hop, else the phone's language.
const stored = (() => { try { return JSON.parse(localStorage.getItem('bl-lang')); } catch { return null; } })();
const lang = STRINGS[stored] ? stored : (navigator.language || '').startsWith('es') ? 'es' : (navigator.language || '').startsWith('zh') ? 'zh' : 'en';
document.documentElement.lang = { en: 'en', es: 'es', zh: 'zh-CN' }[lang];
function t(key, vars = {}) {
  const get = L => key.split('.').reduce((o, k) => (o == null ? o : o[k]), STRINGS[L]);
  const s = get(lang) ?? get('en') ?? key;
  return typeof s === 'string' ? s.replace(/\{(\w+)\}/g, (_, k) => vars[k] ?? '') : s;
}
const heroName = id => t('heroes.' + id);

// A random id this phone keeps for the session, so a reconnect gets its old slot back.
let pid;
try {
  pid = sessionStorage.getItem('fhPid');
  if (!pid) sessionStorage.setItem('fhPid', pid = crypto.randomUUID().replace(/-/g, ''));
} catch { pid = crypto.randomUUID().replace(/-/g, ''); }

const me = { hero: null, pad: '#ff7fb8', oct: 0, sus: 0.35, drums: false, hasDrums: false };
let ws = null, retry = 0, ended = false, pingTimer = null;

$('pickTitle').textContent = t('remote.pick');
$('susLabel').textContent = t('sustain');
$('octLabel').textContent = t('octave');
$('changeBtn').textContent = t('remote.change');

function status(text, ok) {
  $('status').textContent = text;
  $('dot').classList.toggle('ok', !!ok);
}
function show(which, text) {   // 'msg', 'picker' or 'deck'
  $('msg').hidden = which !== 'msg';
  $('picker').hidden = which !== 'picker';
  $('deck').hidden = which !== 'deck';
  if (text != null) $('msg').textContent = text;
  $('changeBtn').hidden = which !== 'deck';
}
const send = obj => { if (ws && ws.readyState === 1) ws.send(JSON.stringify(obj)); };

if (!room || !relay) {
  status(t('remote.off'));
  show('msg', t('remote.noRoom'));
} else connect();

function connect() {
  if (ended) return;
  status(t('remote.connecting'));
  const sock = ws = new WebSocket(relay.replace(/\/$/, '') + '/room/' + room + '?role=player&pid=' + pid);
  sock.onopen = () => {
    retry = 0;
    clearInterval(pingTimer);
    pingTimer = setInterval(() => { if (sock.readyState === 1) sock.send('ping'); }, 25000);
  };
  sock.onmessage = e => {
    if (typeof e.data !== 'string' || e.data === 'pong') return;
    let msg;
    try { msg = JSON.parse(e.data); } catch { return; }
    handle(msg);
  };
  sock.onclose = () => {
    clearInterval(pingTimer);
    if (ws === sock) ws = null;
    if (ended) return;
    status(t('remote.reconnecting'));
    setTimeout(connect, Math.min(15000, 1000 * 2 ** retry++));
  };
  sock.onerror = () => {};
}

const hello = () => send({ t: 'hello', hero: me.hero });
function handle(msg) {
  if (msg.t === 'sys') {
    if (msg.ev === 'full') { ended = true; status(t('remote.off')); show('msg', t('remote.full')); }
    else if (msg.ev === 'welcome') { if (msg.host) hello(); else { status(t('remote.waiting')); show('msg', t('remote.waitingLong')); } }
    else if (msg.ev === 'peer-joined' && msg.role === 'host') hello();
    else if (msg.ev === 'peer-left' && msg.role === 'host') { status(t('remote.waiting')); show('msg', t('remote.waitingLong')); }
  } else if (msg.t === 'who') hello();
  else if (msg.t === 'lobby') {
    status(t('remote.connected'), true);
    me.hero = null;
    $('whoName').textContent = 'Farm Hop';
    renderPicker(msg.heroes || [], msg.taken || []);
    show('picker');
  } else if (msg.t === 'joined') {
    status(t('remote.connected'), true);
    me.hero = msg.hero;
    me.pad = msg.pad;
    me.hasDrums = !!msg.drums;
    if (!me.hasDrums) me.drums = false;
    document.documentElement.style.setProperty('--c', me.pad);
    $('whoName').textContent = heroName(me.hero);
    $('instBtn').hidden = !me.hasDrums;
    send({ t: 'oct', v: me.oct });
    send({ t: 'sus', v: me.sus });
    send({ t: 'mode', drums: me.drums });
    setMode(me.drums);
    show('deck');
    wake();
  } else if (msg.t === 'bye') {
    ended = true;
    status(t('remote.off'));
    show('msg', t('remote.ended'));
    ws?.close();
  }
}

function renderPicker(heroes, taken) {
  const grid = $('pickGrid');
  grid.innerHTML = '';
  for (const h of heroes) {
    const b = document.createElement('button');
    b.className = 'pick';
    b.style.setProperty('--c', h.pad);
    const busy = taken.includes(h.id);   // already on stage: still fine to pick (a new farm only has Betty Lou)
    b.innerHTML = '<span></span>' + (busy ? '<small></small>' : '');
    b.querySelector('span').textContent = heroName(h.id);
    if (busy) b.querySelector('small').textContent = t('remote.taken');
    b.addEventListener('click', () => send({ t: 'pick', hero: h.id }));
    grid.append(b);
  }
}
$('changeBtn').addEventListener('click', () => { send({ t: 'leave' }); me.hero = null; hello(); });

// ---------- the pads ----------
// Same layout as the Jam Stage: three rows (high, middle, low octave) of six notes,
// the D pads ringed; or the drum kit, two rows of four.
const pads = $('pads');
for (let r = 0; r < 3; r++) for (let c = 0; c < 6; c++) {
  const p = document.createElement('button');
  p.className = 'pad' + (c === 0 || c === 5 ? ' root' : '');
  hold(p, () => send({ t: 'note', r, c, on: 1 }), () => send({ t: 'note', r, c, on: 0 }));
  pads.append(p);
}
const DRUM_GRID = [4, 5, 6, 7, 0, 1, 2, 3];
const DRUM_COLORS = ['#ff6b6b', '#fff1d8', '#ffd24a', '#ffe68a', '#ff7fb8', '#7fd0ff', '#a6e3ff', '#bd96ff'];
const drums = $('drums');
for (const d of DRUM_GRID) {
  const p = document.createElement('button');
  p.className = 'pad';
  p.style.setProperty('--pc', DRUM_COLORS[d]);
  p.textContent = t('drumNames')[d];
  hold(p, () => send({ t: 'drum', d }), () => {});
  drums.append(p);
}
// Each finger is its own note: down plays it, up (or sliding off) lets it go.
function hold(el, down, up) {
  const fingers = new Set();
  el.addEventListener('pointerdown', e => {
    e.preventDefault();
    if (el.hasPointerCapture(e.pointerId)) el.releasePointerCapture(e.pointerId);
    fingers.add(e.pointerId);
    el.classList.add('on');
    if (navigator.vibrate) navigator.vibrate(8);
    down();
  });
  const off = e => {
    if (!fingers.delete(e.pointerId)) return;
    if (!fingers.size) el.classList.remove('on');
    up();
  };
  for (const type of ['pointerup', 'pointercancel', 'pointerleave']) el.addEventListener(type, off);
}

function setOct(v) {
  me.oct = Math.max(-1, Math.min(1, v));
  $('octN').textContent = (me.oct > 0 ? '+' : '') + me.oct;
  $('octUp').disabled = me.oct >= 1;
  $('octDown').disabled = me.oct <= -1;
  send({ t: 'oct', v: me.oct });
}
$('octUp').addEventListener('click', () => setOct(me.oct + 1));
$('octDown').addEventListener('click', () => setOct(me.oct - 1));
setOct(0);
const sus = $('sus');
let susTimer = null;
function setSus(v, now) {
  me.sus = v;
  sus.value = Math.round(v * 100);
  sus.style.setProperty('--fill', sus.value + '%');
  clearTimeout(susTimer);   // at most a few updates a second while dragging
  if (now) send({ t: 'sus', v });
  else susTimer = setTimeout(() => send({ t: 'sus', v: me.sus }), 120);
}
sus.addEventListener('input', () => setSus(sus.value / 100));
sus.addEventListener('change', () => setSus(sus.value / 100, true));
setSus(me.sus);
function setMode(on) {
  me.drums = on && me.hasDrums;
  $('deck').classList.toggle('drumMode', me.drums);
  pads.hidden = me.drums;
  drums.hidden = !me.drums;
  $('instBtn').textContent = me.drums ? '♪' : '🥁';
  $('instBtn').setAttribute('aria-label', me.drums ? t('aria.instHopper', { name: heroName(me.hero || 'betty') }) : t('aria.instDrums'));
}
$('instBtn').addEventListener('click', () => { setMode(!me.drums); send({ t: 'mode', drums: me.drums }); });

// Keep the screen on while jamming, where the phone allows it.
let lock = null;
async function wake() {
  try { if (!lock && navigator.wakeLock) { lock = await navigator.wakeLock.request('screen'); lock.addEventListener('release', () => { lock = null; }); } } catch {}
}
document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible' && me.hero) wake(); });
document.addEventListener('touchmove', e => { if (!e.target.closest('input[type=range], #picker')) e.preventDefault(); }, { passive: false });
