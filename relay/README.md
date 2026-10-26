# Farm Hop relay (Cloudflare Worker)

Connects the game on a TV or computer to up to four phones for jamming on the
Jam Stage. The phones scan a QR code and open `/farmhop/remote/`. See `worker.js`
for the rules (one host and up to four players per room, size and rate caps,
allowed origins). Nothing is stored or logged.

This is a separate Worker from `fractalize-relay`, on the same Cloudflare account.

## Deploy

From this `relay/` folder (Node.js needed; `wrangler login` only the first time):

```
npx wrangler login
npx wrangler deploy
```

`deploy` prints the address, like `https://farmhop-relay.<you>.workers.dev`. Put it
in `../relay-config.js`, switching `https://` to `wss://`, then commit and push:

```js
window.FARMHOP_RELAY_URL = "wss://farmhop-relay.<you>.workers.dev";
```

The "Jam with phones" button then appears on the Jam Stage.

## Testing locally

`npx wrangler dev` runs the relay at `ws://localhost:8787`. Open the game with
`?debug&relay=ws://localhost:8787`; the QR code it shows carries that address to
the phone page.

## Notes

- Allowed browser origins are at the top of `worker.js`. Edit and run
  `npx wrangler deploy` again if the site's address changes.
- Cost: normally free on the Workers Free plan.
