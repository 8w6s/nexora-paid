# Per-Invoice Image + Registry Gate

The runtime gating model in v1.1+. Replaces the `.license` file flow
(still supported for v1 customers — see [LICENSE_OPS.md](LICENSE_OPS.md)).

## Why

The old `.license` file model has two leaks:

- A leaked license file works on any host. Watermark only helps **after**
  the leak surfaces.
- Revocation is documented but not wired into runtime code.

The per-invoice flow fixes both:

- The invoice id is **baked into the image** as `ENV NEXORA_INVOICE_ID`.
  Customer admins can't rewrite it without rebuilding from source.
- Every boot + every 24h, the backend fetches
  `invoices/<id>.json` from your private `nexora-releases` repo and checks
  `status` + `expiresAt` + signature. Flip `status: "revoked"` and commit →
  customer loses paid features on next refresh.

## Wire diagram

```
You (maintainer)
 ├─ Stripe / billing notifies you of a new paid order
 │
 ├─ bun run scripts/sign-invoice.ts --id=inv_2026_001 --email=...
 │     → issued/inv_2026_001.json   (ed25519-signed)
 │
 ├─ Commit it to nexora-releases as invoices/inv_2026_001.json
 │
 ├─ Click "Run workflow" on customer-build.yml
 │     inputs: invoice_id=inv_2026_001  email=...  version=1.0.0
 │     → ghcr.io/<you>/nexora-backend:1.0.0-inv_2026_001
 │
 └─ Email the customer:
     - image refs above
     - a PAT with read:packages + contents:read on nexora-releases
     - their copy of .env (with NEXORA_GHCR_TOKEN baked in)

Customer
 ├─ docker compose -f docker-compose.yml -f docker-compose.updater.yml up -d
 │     (image pulled from GHCR; no source code shipped)
 │
 └─ backend boots
     ├─ NEXORA_INVOICE_ID is baked → invoice gate active
     ├─ fetch invoices/inv_2026_001.json from nexora-releases
     ├─ verify ed25519 signature with embedded pubkey
     └─ status="active" → paid plugins load. otherwise → free-only.
```

## Status states

| status      | banner   | paid plugins | when to use                |
|-------------|----------|-------------|----------------------------------------|
| `active`    | green    | ✅ load      | normal paid customer                   |
| `suspended` | amber    | ❌ off       | non-payment, retry hold; reversible    |
| `revoked`   | red      | ❌ off       | chargeback, leaked image, refund       |

`expiresAt` (ISO timestamp) overrides `status: active` once `Date.now()`
passes it. Absent = lifetime.

## Day-to-day operations

### Issue a new customer

```bash
# 1. Sign the invoice file locally
bun run scripts/sign-invoice.ts \
  --id=inv_2026_002 \
  --email=alice@example.com \
  --features=search-suggest,admin-bulk,admin-export,admin-customers-csv \
  --note="lifetime, paid 2026-06-27"

# 2. Commit to private releases repo
cp issued/inv_2026_002.json /path/to/nexora-releases/invoices/
cd /path/to/nexora-releases && git add . && git commit -m "issue inv_2026_002" && git push

# 3. Dispatch customer-build.yml via GitHub UI:
#    invoice_id=inv_2026_002  email=alice@example.com  version=1.0.0
```

### Revoke a customer (chargeback, leak, etc.)

Hand-edit `nexora-releases/invoices/<id>.json`, change
`"status": "active"` → `"status": "revoked"`. **Re-sign** with
`sign-invoice.ts --id=<same> --status=revoked --email=<same>` so the
signature still verifies. Commit + push. Customer loses paid features
within 24h (or instantly if they restart).

> The customer cannot pin to a stale cached invoice forever: the on-disk
> cache (`invoice-cache.json`) has a 7-day grace period for network blips
> but is rewritten on every successful fetch, so the new `revoked` record
> will replace the cached `active` one.

### Re-issue after a status fix

Same `--id`, run `sign-invoice.ts` again with the desired status, replace
the file in the releases repo. The pubkey doesn't change.

### Bump base version + per-invoice image refresh

Push a `v*` tag → `release.yml` builds the `:<version>-base` image and
publishes a signed `stable.signed.json`. For each customer who should get
the update, dispatch `customer-build.yml` with `version=<new version>`.
The customer clicks "Apply update" in the admin UI; the manifest's
`imageTag: "1.2.0-${INVOICE_ID}"` resolves to their own tag, the updater
pulls the right image, and snapshot+rollback work as before.

## Token scopes the customer needs

A single fine-grained PAT covers both reads:

- **GHCR pull**: `read:packages` (account-level, classic PAT) OR a
  fine-grained PAT with `Packages: read` on the org.
- **Invoice fetch**: fine-grained PAT with `Contents: read` on the
  `nexora-releases` repo only.

Set it as `NEXORA_GHCR_TOKEN` in their `.env`. The same variable is
read by both the backend (for the invoice fetch) and the updater (for
docker pull).

## Secrets the maintainer needs in `nexora-paid` repo

| Scope    | Name                       | Purpose                                                       |
|----------|----------------------------|---------------------------------------------------------------|
| secret   | `NEXORA_SIGNING_KEY`       | The hex bytes of `.keys/license-signer.private`. Used by `release.yml` to sign `stable.signed.json`. |
| secret   | `RELEASES_REPO_TOKEN`      | PAT with `contents:write` on `nexora-releases`.                |
| variable | `NEXORA_RELEASES_REPO`     | e.g. `8w6s/nexora-releases`                    |
| variable | `NEXORA_MIN_VERSION`       | (optional) minimum supported version for the manifest's `min` field. Defaults to `1.0.0`. |

## Failure modes

| What happens                       | Customer sees                          |
|------------------------------------|----------------------------------------|
| PAT not set                        | invoice fetch 401 → paid features off  |
| PAT lacks repo access              | same                                   |
| Network down at boot, cache fresh  | uses cached verdict, paid stays on     |
| Network down at boot, cache stale  | paid features off                      |
| Invoice file 404 (deleted)         | paid features off, red banner          |
| Signature mismatch                 | paid features off, red banner          |
| `status=revoked` or expired        | paid features off, red baner          |
| `NEXORA_INVOICE_ID` empty in image | falls back to legacy `.license` flow   |