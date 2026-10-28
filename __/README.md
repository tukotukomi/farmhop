# Firebase sign-in helper, served from farmhop.fun

Google sign-in returns to `https://farmhop.fun/__/auth/handler` instead of
`fun-by-tuko.firebaseapp.com`, so Safari and other browsers that block third-party
storage don't lose the sign-in (Firebase's "self-host the helper code" option).
The files come from `https://fun-by-tuko.firebaseapp.com/__/auth/<file>` (handler,
iframe and links are saved as .html so GitHub Pages serves them as pages);
`firebase/init.json` is written by hand from the project's web config. Download
them again now and then to pick up Firebase's fixes. `.nojekyll` at the root lets
GitHub Pages serve this `__` folder.

The Google Cloud OAuth client (APIs & Services > Credentials > "Web client (auto
created by Google Service)") lists `https://farmhop.fun/__/auth/handler` as an
authorized redirect URI. Each other site that hosts these files adds its own.
