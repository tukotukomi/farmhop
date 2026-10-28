// Tuko account: Google sign-in and cloud saves, shared by Tucker's sites (Farm Hop,
// Fractalize Studio, Fantasy Radio Companion). Firebase does the security: Google
// signs people in, and Firestore's rules (firestore.rules, next to this file) let
// each person read and write only their own saves, one document per site:
//
//   users/{uid}/apps/{app}  = { v: 1, data: { ...the site's save }, savedAt, device }
//
// The site keeps saving on the device as always; this copies it to the account a
// few seconds after it changes, and brings it down on another device.
//
//   const acct = createAccount({
//     app: 'farmhop', config,              // config: the Firebase web app's settings
//     read: () => ({ ... }),               // this device's save, as plain JSON-able data
//     write: data => { ... },              // replace this device's save (then reload, say)
//     fresh: data => true/false,           // nothing worth keeping yet? (a new device)
//   });
//   acct.on(state => ...)   // { ready, user: { name, email, photo } | null, status, savedAt, conflict }
//   acct.signIn()  acct.signOut()  acct.changed()  acct.keep('device' | 'account')  acct.deleteAll()
//
// status: 'off' (signed out), 'syncing', 'saved', 'error', 'conflict' (this device and
// the account both moved on since they last agreed: the site asks which to keep).
//
// Firebase only loads once someone signs in (or was signed in before), so sites
// stay as quick as ever for everyone else.

const SDK = 'https://www.gstatic.com/firebasejs/10.12.2/';
const KNOWN_APPS = ['farmhop', 'fractalize', 'fantasyradio'];   // also listed in firestore.rules

function hash(data) {   // FNV-1a over the save with its keys in order: "has it changed?"
  const s = JSON.stringify(data, Object.keys(data || {}).sort());
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 0x01000193); }
  return (h >>> 0).toString(36);
}
const lsGet = k => { try { return JSON.parse(localStorage.getItem(k)); } catch { return null; } };
const lsSet = (k, v) => { try { v == null ? localStorage.removeItem(k) : localStorage.setItem(k, JSON.stringify(v)); } catch { } };

export function createAccount({ app, config, read, write, fresh = () => false }) {
  if (!KNOWN_APPS.includes(app)) throw new Error('tuko-account: unknown app ' + app);
  const META = 'tuko-sync-' + app;   // { uid, at, hash }: what this device and the account last agreed on
  const SIGNED = 'tuko-signed-in';   // load Firebase straight away next time
  const device = lsGet('tuko-device') || (() => { const d = crypto.randomUUID().slice(0, 8); lsSet('tuko-device', d); return d; })();
  const state = { ready: false, user: null, status: 'off', savedAt: 0, conflict: null };
  const fns = new Set();
  const emit = () => { for (const f of fns) f(state); };
  let fb = null, auth = null, db = null, timer = null, busy = Promise.resolve();

  async function load() {
    if (fb) return fb;
    if (!config) throw new Error('tuko-account: no Firebase config');
    const [A, U, F] = await Promise.all(['firebase-app.js', 'firebase-auth.js', 'firebase-firestore.js'].map(f => import(SDK + f)));
    const fbApp = A.getApps().length ? A.getApp() : A.initializeApp(config);
    auth = U.getAuth(fbApp);
    db = F.getFirestore(fbApp);
    fb = { U, F };
    U.getRedirectResult(auth).catch(err => { console.warn('tuko-account', err); state.status = 'error'; emit(); });   // back from Google's page
    U.onAuthStateChanged(auth, u => {
      state.ready = true;
      state.user = u ? { uid: u.uid, name: u.displayName || '', email: u.email || '', photo: u.photoURL || '' } : null;
      lsSet(SIGNED, u ? true : null);
      if (u) queue(sync);
      else { state.status = 'off'; state.conflict = null; emit(); }
    });
    return fb;
  }
  const ref = () => fb.F.doc(db, 'users', state.user.uid, 'apps', app);
  const queue = job => (busy = busy.then(job).catch(err => { console.warn('tuko-account', err); state.status = 'error'; emit(); }));
  const agree = (at, h) => { lsSet(META, { uid: state.user.uid, at, hash: h }); state.savedAt = at; state.status = 'saved'; state.conflict = null; emit(); };

  // Bring this device and the account together: whichever moved on wins; if both
  // did, ask.
  async function sync() {
    if (!state.user) return;
    state.status = 'syncing'; emit();
    const snap = await fb.F.getDoc(ref());
    const local = read(), h = hash(local), meta = lsGet(META);
    if (!snap.exists()) return push(local);
    const cloud = snap.data(), at = cloud.savedAt?.toMillis?.() || 0;
    if (hash(cloud.data) === h) return agree(at, h);                   // already the same
    const same = meta && meta.uid === state.user.uid;
    const deviceMoved = !same || meta.hash !== h, accountMoved = !same || meta.at !== at;
    if (!accountMoved) return push(local);                             // only this device played on
    if (!deviceMoved || fresh(local)) return pull(cloud, at);          // only the account did (or this device is new)
    state.status = 'conflict';
    state.conflict = { device: local, account: cloud.data, at };
    emit();
  }
  async function push(local = read()) {
    await fb.F.setDoc(ref(), { v: 1, data: local, savedAt: fb.F.serverTimestamp(), device });
    const snap = await fb.F.getDoc(ref());
    agree(snap.data()?.savedAt?.toMillis?.() || Date.now(), hash(local));
  }
  function pull(cloud, at) {
    lsSet(META, { uid: state.user.uid, at, hash: hash(cloud.data) });
    write(cloud.data);
  }
  // A save changed on this device: send it up in a few seconds (once things settle),
  // checking first that another device hasn't saved in the meantime.
  async function saveNow() {
    if (!state.user || state.status === 'conflict') return;
    const local = read(), h = hash(local), meta = lsGet(META);
    if (meta && meta.uid === state.user.uid && meta.hash === h) return;   // nothing new
    state.status = 'syncing'; emit();
    const snap = await fb.F.getDoc(ref());
    const at = snap.exists() ? snap.data().savedAt?.toMillis?.() || 0 : 0;
    if (snap.exists() && (!meta || meta.uid !== state.user.uid || meta.at !== at) && hash(snap.data().data) !== h) {
      state.status = 'conflict';                                       // another device saved since
      state.conflict = { device: local, account: snap.data().data, at };
      emit();
      return;
    }
    await push(local);
  }

  const acct = {
    state,
    on(f) { fns.add(f); f(state); return () => fns.delete(f); },
    async signIn() {
      await load();
      const provider = new fb.U.GoogleAuthProvider();
      provider.setCustomParameters({ prompt: 'select_account' });
      // An iPhone Home Screen app goes to Google's page and back (a pop-up there opens
      // in Safari, away from the app); everywhere else a pop-up keeps the game in place.
      if (navigator.standalone === true) { lsSet(SIGNED, true); return fb.U.signInWithRedirect(auth, provider); }
      try { await fb.U.signInWithPopup(auth, provider); }
      catch (e) {
        if (e.code === 'auth/popup-blocked' || e.code === 'auth/operation-not-supported-in-this-environment') { lsSet(SIGNED, true); await fb.U.signInWithRedirect(auth, provider); }
        else if (e.code !== 'auth/popup-closed-by-user' && e.code !== 'auth/cancelled-popup-request') throw e;
      }
    },
    async signOut() {   // the save stays on this device
      if (!auth) return;
      await fb.U.signOut(auth);
      lsSet(META, null);
    },
    changed() {
      if (!state.user) return;
      clearTimeout(timer);
      timer = setTimeout(() => queue(saveNow), 4000);
    },
    flush() { if (state.user) { clearTimeout(timer); queue(saveNow); } },   // e.g. when the page is hidden
    keep(which) {   // settle a conflict
      const c = state.conflict;
      if (!c) return;
      if (which === 'account') pull({ data: c.account }, c.at);
      else queue(() => push(read()));
    },
    // Remove every save this person has on any of the sites, and the account itself.
    async deleteAll() {
      await load();
      if (!state.user) return;
      for (const a of KNOWN_APPS) await fb.F.deleteDoc(fb.F.doc(db, 'users', state.user.uid, 'apps', a));
      lsSet(META, null);
      try { await fb.U.deleteUser(auth.currentUser); }
      catch (e) {
        if (e.code !== 'auth/requires-recent-login') throw e;
        await fb.U.reauthenticateWithPopup(auth.currentUser, new fb.U.GoogleAuthProvider());   // Google asks once more, to be sure
        await fb.U.deleteUser(auth.currentUser);
      }
    },
  };
  if (lsGet(SIGNED) && config) load().catch(err => console.warn('tuko-account', err));
  else { state.ready = true; }
  document.addEventListener('visibilitychange', () => { if (document.hidden) acct.flush(); });
  return acct;
}
