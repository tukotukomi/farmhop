// Address of the Cloudflare Worker relay that lets phones join a jam on the Jam
// Stage (see relay/ and remote/). Leave empty to hide the "Jam with phones" button.
// Set to the deployed Worker's wss:// URL, e.g. "wss://farmhop-relay.<you>.workers.dev".
window.FARMHOP_RELAY_URL = "wss://farmhop-relay.fractalize-studio.workers.dev";

// Address of the Hop Supporters worker (see support/). Leave empty to hide
// "Become a Hop Supporter" in Settings.
// The $5 Stripe Payment Link (the main "Support $5" button). Empty: Ko-fi only.
window.FARMHOP_STRIPE_LINK = "https://donate.stripe.com/cNi7sLfaUdic0Xj9D783C00";
window.FARMHOP_SUPPORT_URL = "https://farmhop-support.fractalize-studio.workers.dev";
