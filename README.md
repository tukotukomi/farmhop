# Betty Lou's Farm Hop

A cosy hopping game: help Betty Lou and friends hop across farm roads, pastures
and creeks before the sun sets, then grow the farm with the sunflowers you pick.
Play it at **https://farmhop.fun**.

Plain HTML, CSS and JavaScript with three.js from a CDN: no build step. GitHub
Pages serves this repo's `main` branch at farmhop.fun (see `CNAME`).

- `index.html`, `game.js`, `style.css`, `lang.js` (English, Spanish, Chinese), `music.js`
- `remote/`: the phone page for jamming and Co-Op Hop (opened from the QR code)
- `relay/`: the Cloudflare Worker that connects phones to the game (see its README)
- `relay-config.js`: the relay's address

Run locally with the `farmhop` entry in `.claude/launch.json`, then open
`/?debug` for test helpers.

Moved here from tuckermills.com/farmhop on 2026-10-27, history included;
that address now forwards here. Saved farms stay with the address they were made on.
