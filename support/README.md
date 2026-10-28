# Farm Hop supporters (Cloudflare Worker + KV)

"Become a Hop Supporter" in the game's Settings. The player copies a code like
`HOP-7KQ3MX`, supports $5 on Ko-fi (ko-fi.com/funbytuko) with the code in their
message, and Ko-fi tells this worker. The game asks `/check` every few seconds and
unlocks: DJ Ribbit and Moonbun, the supporter heart, and the drum and bass farm song.
See `worker.js` for the endpoints. Emails are only kept as a SHA-256 hash, so a
supporter can restore on a new device with the email they used on Ko-fi.

## Deploy (once)

From this `support/` folder:

```
npx wrangler@3 kv:namespace create SUPPORT
```

Put the `id` it prints into `wrangler.toml`. Then set the two secrets. Each command
asks for the value, so it never goes in a file:

```
npx wrangler@3 secret put KOFI_TOKEN
npx wrangler@3 secret put ADMIN_KEY
```

- `KOFI_TOKEN`: Ko-fi > Settings > More > API > Webhooks > "Verification Token".
- `ADMIN_KEY`: any long password you choose, for the admin page.

```
npx wrangler@3 deploy
```

It prints the address, like `https://farmhop-support.<you>.workers.dev`.

1. In Ko-fi's webhook settings, set the URL to `https://farmhop-support.<you>.workers.dev/kofi`.
2. In `../relay-config.js`, set `window.FARMHOP_SUPPORT_URL` to the address (no `/kofi`),
   then commit and push. The supporter row appears in Settings.

## Admin page

`https://farmhop-support.<you>.workers.dev/admin`: enter the admin key to see who has
supported, give a code to someone who forgot to paste theirs ("Give a code"), or
make a free gift code (for family, or to try the perks yourself).

## Testing locally

Make `.dev.vars` here (git ignores it):

```
KOFI_TOKEN=local-test-token
ADMIN_KEY=local-admin
```

`npx wrangler@3 dev --port 8790 --local`, then open the game with
`?debug&support=http://127.0.0.1:8790`. Fake a payment:

```
curl -X POST http://127.0.0.1:8790/kofi --data-urlencode 'data={"verification_token":"local-test-token","kofi_transaction_id":"t1","amount":"5.00","message":"HOP-XXXXXX","email":"me@example.com"}'
```
