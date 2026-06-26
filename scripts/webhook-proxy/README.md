# Webhook Proxy (Cloudflare Worker)

Verifies LemonSqueezy webhook signatures before forwarding to GitHub Actions.

## Why

GitHub `repository_dispatch` has no built-in signature verification. Anyone
who knows the endpoint can fire fake events and get free licenses signed.
This Worker sits between LemonSqueezy and GitHub, verifying the HMAC-SHA256
signature before forwarding.

## Setup (one-time, ~5 minutes)

### 1. Deploy the Worker

```bash
cd scripts/webhook-proxy
npx wrangler deploy
```

### 2. Set secrets

```bash
npx wrangler secret put LEMONSQUEEZY_WEBHOOK_SECRET
# Paste the signing secret from LemonSqueezy → Settings → Webhooks

npx wrangler secret put GITHUB_PAT
# Fine-grained PAT: repo contents:write on 8w6s/nexora-paid
```

### 3. Configure LemonSqueezy webhook

In LemonSqueezy → Settings → Webhooks:
- **URL**: `https://nexora-webhook.<your-account>.workers.dev`
- **Events**: `order_created`
- **Signing secret**: same value you put in step 2

### 4. Test

Create a test order on LemonSqueezy (test mode). Check:
- GitHub Actions → fulfill-order workflow runs
- Customer email arrives with license

## How it works

```
LemonSqueezy → POST with X-Signature header
    ↓
Worker: verify HMAC-SHA256(body, secret) == X-Signature
    ↓ (verified)
Worker → POST github.com/repos/.../dispatches
    { event_type: "order_paid", client_payload: { email, tier, ... } }
    ↓
GitHub Actions fulfill.yml → sign license → ZIP → email
```

## Costs

Cloudflare Workers free tier: 100,000 requests/day. You'll never hit this
selling software licenses.