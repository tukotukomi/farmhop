// Playing on a friend's farm. An invite link (#join=<room>) opens the whole game
// on this phone or computer as a guest: it joins the host's room on the relay
// (relay/), offers a direct WebRTC link like the jam phones do, and waits for the
// host to send its farm. The game then runs here, showing that farm instead of
// this device's own, which is never touched.
//
//   const net = await joinFarm(room, relay, text);   // resolves with the first farm
//   net.farm                                         // { keys: {bl-*: value}, walkers: [...] }
//   net.send({ ... })                                // to the host
//   net.on(msg => { ... })                           // everything else the host sends

const ICE = [{ urls: 'stun:stun.cloudflare.com:3478' }];

// A full-screen note while connecting or when the host is away.
function waitNote(home, text) {
  const el = document.createElement('div');
  el.id = 'guestWait';
  el.innerHTML = '<div class="guestCard"><span class="guestDot"></span><p></p></div>';
  if (home) {   // never stuck waiting: a way back to your own farm
    const b = document.createElement('button');
    b.className = 'chipBtn';
    b.textContent = text('guest.home');
    b.addEventListener('click', home);
    el.firstChild.append(b);
  }
  document.body.append(el);
  return {
    show(text) { el.querySelector('p').textContent = text; el.hidden = false; },
    hide() { el.hidden = true; },
  };
}

export function joinFarm(room, relay, text, wantHero, about = () => ({}), home = null) {
  let pid;
  try {
    pid = sessionStorage.getItem('bl-guest-pid');
    if (!pid) sessionStorage.setItem('bl-guest-pid', pid = crypto.randomUUID().replace(/-/g, ''));
  } catch { pid = crypto.randomUUID().replace(/-/g, ''); }

  const note = waitNote(home, text);
  let ws = null, retry = 0, ping = null, pc = null, dc = null, ended = false;
  let handler = null, first = null;
  const early = [];   // messages that came before the game was ready for them
  const deliver = m => { if (handler) handler(m); else early.push(m); };
  const net = {
    farm: null, path: '',
    send(obj) {
      const s = JSON.stringify(obj);
      if (dc && dc.readyState === 'open') dc.send(s);
      else if (ws && ws.readyState === 1) ws.send(s);
    },
    on(fn) { handler = fn; for (const m of early.splice(0)) fn(m); },
    note,
  };
  const relaySend = obj => { if (ws && ws.readyState === 1) ws.send(JSON.stringify(obj)); };
  const hello = () => relaySend({ t: 'hello', guest: true, hero: wantHero(), ...about() });   // about: e.g. { sup: true } for a Hop Supporter

  // The direct link: offered once the host has taken us, through the relay.
  function startDirect() {
    if (!window.RTCPeerConnection || (dc && dc.readyState === 'open')) return;
    stopDirect();
    const myPc = pc = new RTCPeerConnection({ iceServers: ICE });
    const myDc = dc = pc.createDataChannel('farmhop', { ordered: true });
    myDc.onmessage = e => { let m; try { m = JSON.parse(e.data); } catch { return; } handle(m); };
    myDc.onclose = () => { if (dc === myDc) dc = null; };
    myPc.onicecandidate = e => { if (e.candidate) relaySend({ t: 'rtc', c: e.candidate.toJSON() }); };
    myPc.onconnectionstatechange = () => { if (['failed', 'closed'].includes(myPc.connectionState) && pc === myPc) stopDirect(); };
    myPc.createOffer().then(o => myPc.setLocalDescription(o)).then(() => relaySend({ t: 'rtc', sdp: myPc.localDescription })).catch(stopDirect);
  }
  function stopDirect() {
    try { dc?.close(); pc?.close(); } catch {}
    pc = dc = null;
    net.path = '';
  }

  function handle(m) {
    if (m.t === 'sys') {
      if (m.ev === 'full') { ended = true; note.show(text('guest.full')); ws?.close(); }
      else if (m.ev === 'welcome') { if (m.host) hello(); else note.show(text('guest.waiting')); }
      else if (m.ev === 'peer-joined' && m.role === 'host') { stopDirect(); hello(); }
      else if (m.ev === 'peer-left' && m.role === 'host') { stopDirect(); note.show(text('guest.waiting')); }
      return;
    }
    if (m.t === 'who') { stopDirect(); hello(); return; }
    if (m.t === 'rtc') {
      if (m.sdp && pc) pc.setRemoteDescription(m.sdp).catch(stopDirect);
      else if (m.c && pc) pc.addIceCandidate(m.c).catch(() => {});
      return;
    }
    if (m.t === 'path') { net.path = m.path || ''; return; }
    if (m.t === 'bye') { ended = true; stopDirect(); note.show(text('guest.ended')); ws?.close(); return; }
    if (m.t === 'farm') {
      note.hide();
      if (!net.farm) { net.farm = m.farm; first?.(net); }
      startDirect();
    }
    deliver(m);
  }

  function connect() {
    if (ended) return;
    const sock = ws = new WebSocket(relay.replace(/\/$/, '') + '/room/' + room + '?role=player&pid=' + pid);
    sock.onopen = () => {
      retry = 0;
      clearInterval(ping);
      ping = setInterval(() => { if (sock.readyState === 1) sock.send('ping'); }, 25000);
    };
    sock.onmessage = e => {
      if (typeof e.data !== 'string' || e.data === 'pong') return;
      let m;
      try { m = JSON.parse(e.data); } catch { return; }
      handle(m);
    };
    sock.onclose = () => {
      clearInterval(ping);
      if (ws === sock) ws = null;
      if (ended) return;
      note.show(text('guest.reconnecting'));
      setTimeout(connect, Math.min(15000, 1000 * 2 ** retry++));
    };
    sock.onerror = () => {};
  }

  note.show(text('guest.joining'));
  return new Promise(resolve => { first = resolve; connect(); });
}
