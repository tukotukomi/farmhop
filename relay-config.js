// Address of the Cloudflare Worker relay that lets phones join a jam on the Jam
// Stage (see relay/ and remote/). Leave empty to hide the "Jam with phones" button.
// Set to the deployed Worker's wss:// URL, e.g. "wss://farmhop-relay.<you>.workers.dev".
window.FARMHOP_RELAY_URL = "wss://farmhop-relay.fractalize-studio.workers.dev";

// Address of the Hop Supporters worker (see support/). Leave empty to hide
// "Become a Hop Supporter" in Settings.
// The $5 Stripe Payment Link (the main "Support $5" button). Empty: Ko-fi only.
window.FARMHOP_STRIPE_LINK = "https://donate.stripe.com/cNi7sLfaUdic0Xj9D783C00";
window.FARMHOP_SUPPORT_URL = "https://farmhop-support.fractalize-studio.workers.dev";

// The Firebase web app's settings (Firebase console > Project settings > Your apps),
// for "Sign in with Google" and cloud saves (see account/). These are not secrets:
// Firestore's rules decide who can read what. Leave null to hide the Account row.
window.TUKO_FIREBASE = {
  apiKey: "AIzaSyDyj8JCrPoTyJ0aBVyftGmAp7RUD9-9UF8",
  // farmhop.fun serves Firebase's sign-in helper itself (see __/), so sign-in stays on this site
  authDomain: /(^|.)farmhop.fun$/.test(location.hostname) ? location.hostname : "fun-by-tuko.firebaseapp.com",
  projectId: "fun-by-tuko",
  storageBucket: "fun-by-tuko.firebasestorage.app",
  messagingSenderId: "1017717662779",
  appId: "1:1017717662779:web:e0ca54e2c124b5c5dea81e",
};
