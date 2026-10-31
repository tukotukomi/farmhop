# Farm Hop supporters (Cloudflare Worker + KV)

"Become a Hop Supporter" in the game's Settings. Each player gets a code like
`HOP-7KQ3MX`. The main button opens a $5 Stripe Payment Link with the code built in
(`?client_reference_id=HOP-7KQ3MX`), so there's nothing to paste. Or they support on
Ko-fi (ko-fi.com/funbytuko) with the code in their message. Stripe or Ko-fi tells
this worker. The game asks `/check` every few seconds and
unlocks: DJ Ribbit and Moonbun, the supporter heart, and the Drum & Bass, Farm House and Psy Farm songs.
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
- `STRIPE_WEBHOOK_SECRET`: the `whsec_...` signing secret of the Stripe webhook below
  (`npx wrangler@3 secret put STRIPE_WEBHOOK_SECRET`).
- `ADMIN_KEY`: any long password you choose, for the admin page.

```
npx wrangler@3 deploy
```

It prints the address, like `https://farmhop-support.<you>.workers.dev`.

1. Stripe: make a $5 Payment Link (Product "Hop Supporter"). Under "After payment",
   keep the confirmation page with a message like "Thank you! Go back to Farm Hop: it
   unlocks by itself." Put the link in `../relay-config.js` as `FARMHOP_STRIPE_LINK`.
   Then Developers > Webhooks > Add endpoint:
   `https://farmhop-support.<you>.workers.dev/stripe`, event `checkout.session.completed`.
   Its signing secret is `STRIPE_WEBHOOK_SECRET`.
1. In Ko-fi's webhook settings, set the URL to `https://farmhop-support.<you>.workers.dev/kofi`.
2. In `../relay-config.js`, set `window.FARMHOP_SUPPORT_URL` to the address (no `/kofi`),
   then commit and push. The supporter row appears in Settings.

## Admin page

`https://farmhop-support.<you>.workers.dev/admin`: sign in with the admin key and a
6-digit code from an authenticator app (the first visit shows a QR code to set the app
up; to move to a new app, delete the KV key `totp:secret` and visit again). See who has
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
