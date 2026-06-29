# sellauth-fulfill — Cloudflare Worker

SellAuth Dynamic Delivery endpoint. When a customer pays, SellAuth POSTs
to `/deliver`. The Worker:

1. Verifies the HMAC signature against `SELLAUTH_WEBHOOK_SECRET`.
2. Encrypts `email:invoice_id:tier` and appends it to `customers.txt`
   on the `nexora-releases` repo (triggers `auto-build.yml`).
3. Signs an Ed25519 license payload inline.
4. Returns markdown delivery body (license JSON + install command) for
   SellAuth to email the buyer.

Zero PC dependency — runs entirely on Cloudflare.

## One-time setup

```bash
cd workers/sellauth-fulfill
bun install
wrangler login                   # opens browser, authorizes Cloudflare
```

Set the four secrets (paste value when prompted):

```bash
wrangler secret put SELLAUTH_WEBHOOK_SECRET    # from SellAuth → Webhooks
wrangler secret put NEXORA_CUSTOMERS_KEY       # 64-hex, same as repo secret
wrangler secret put LICENSE_SIGNING_KEY_HEX    # 64-hex from .keys/license-signer.private
wrangler secret put GH_PAT                     # GitHub PAT, Contents:write on nexora-releases
```

Optional vars (override via `wrangler secret put` or `wrangler.toml`):

| Name | Default | Purpose |
|---|---|---|
| `INSTALL_URL` | `https://install.nexora.sh/setup.sh` | one-line install command shown to buyer |
| `SUPPORT_EMAIL` | `support@nexora.sh` | support email shown in delivery body |
| `SUPPORT_DISCORD` | _(absent)_ | optional Discord invite URL |

## Deploy

```bash
wrangler deploy
```

Output ends with the public URL:

```
Published sellauth-fulfill
  https://sellauth-fulfill.<your-account>.workers.dev
```

Paste that URL + `/deliver` into your SellAuth product → Delivery →
Dynamic / Webhook → Delivery URL field.

## Verify

```bash
# Liveness
curl https://sellauth-fulfill.<your-account>.workers.dev/health

# Live logs while testing
wrangler tail
```

Then in SellAuth Dashboard → Webhooks → "Send test event" → check that
the Worker returns 200 and `customers.txt` got a new line.

## Variants → tier mapping

SellAuth product variants (case-insensitive, spaces → dashes):

| Variant slug | Tier | License fields |
|---|---|---|
| `6-month`, `6-months`, `6mo` | `6mo` | `expiresAt = +180d`, `updatesUntil = +180d` |
| `1-year`, `1-yr`, `1y`, `yearly` | `1yr` | `expiresAt = +365d`, `updatesUntil = +365d` |
| `lifetime`, `perpetual` | `lifetime` | _(no caps)_ |
| `lts`, `frozen` | `lts` | `updatesUntil = now` (updater refuses) |

Unknown variants default to `6mo` — safest fallback if you ever rename a
SellAuth option without redeploying.

## Iterating

Local dev (Workers runtime, hot reload):

```bash
wrangler dev
```

This serves at `http://localhost:8787`. POST a fake SellAuth payload to
`/deliver` (you'll need to compute HMAC against your local secret) to
exercise the full path without hitting GitHub:

```bash
BODY='{"order_id":"test1","customer_email":"you@example.com","variant":"1-year"}'
SIG=$(echo -n "$BODY" | openssl dgst -sha256 -hmac "$SELLAUTH_WEBHOOK_SECRET" -hex | awk '{print $2}')
curl -X POST http://localhost:8787/deliver \
  -H "content-type: application/json" \
  -H "x-sellauth-signature: $SIG" \
  -d "$BODY"
```

## Trade-offs you should know

- **License signing key is in Cloudflare secrets.** Encrypted at rest;
  read-only after `secret put`. Trade-off: customer gets license instantly
  (no GitHub Action round-trip). Rotate by re-running `gen-keypair.ts` and
  re-deploying both the Worker and a new backend release that embeds the
  new public key.
- **Idempotency:** invoice id is derived from `order_id`. SellAuth retries
  same `order_id` → same line in `customers.txt`. `auto-build.yml`
  dedupes on the receiving end.
- **No state in the Worker.** Stateless by design — Cloudflare can route
  any request to any colo and the result is identical.