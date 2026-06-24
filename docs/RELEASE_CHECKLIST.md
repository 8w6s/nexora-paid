# Nexora Paid — Release Checklist

> One-pager the maintainer runs before shipping a Paid build to a customer.
> Each item is verifiable in < 1 minute. If any check fails, **do not ship**.

## 0. Pre-flight

- [ ] Working tree clean: `git status --short` reports nothing.
- [ ] Branch is `main` (or the release branch) and up to date with origin.
- [ ] `bun install` succeeded; `bun.lock` unchanged after install.
- [ ] No secrets in tracked files: `git grep -E 'license-signer\.private|BEGIN PRIVATE|sk_live'` returns empty.

## 1. License (per customer)

- [ ] `.keys/license-signer.private` exists and matches the embedded pubkey
  in `backend/src/lib/license.ts → LICENSE_PUBKEY_HEX`.
- [ ] Issue the customer's `.license`:
  ```bash
  bun run scripts/sign-license.ts \
    --email=customer@example.com \
    --customer=cus_NNNN \
    --ttl=365 \
    --features=search-suggest,admin-bulk,admin-export
  ```
- [ ] Inspect payload: `jq .payload issued/customer@example.com.license`
  — confirm `customerId`, `expiresAt`, `features[]` match the order.

## 2. Integrity manifest (per build)

- [ ] Build the signed manifest:
  ```bash
  bun run scripts/build-manifest.ts \
    --build-id=build_$(date +%Y-%m-%d)_$(git rev-parse --short HEAD)_cus_NNNN \
    --customer=cus_NNNN
  ```
- [ ] Round-trip verify: `bun run scripts/verify-manifest.ts` → exit 0.
- [ ] Tamper smoke test: `bun run test:integrity` → exit 0, "PASS"
  on every assertion.
- [ ] Manifest file ships INSIDE the tarball next to the binary, NOT
  next to the customer's `.license` (those have different lifecycles).

## 3. Docker compose

- [ ] `docker compose config --quiet` → exit 0.
- [ ] Verify hardening still present on every service:
  - `cap_drop: [ALL]`
  - `security_opt: [no-new-privileges:true]`
  - `tmpfs: [/tmp]`
  - `mem_limit` + `pids_limit` set (caddy 128m/64, backend 512m/256,
    frontend 256m/128, cloudflared 64m/32 — overridable via `NEXORA_*_MEM`)
- [ ] Backend has a `healthcheck` (bun fetch on `/api/health`) and Caddy
  `depends_on: backend: condition: service_healthy` — cold `up` does not 502.
- [ ] `DB_PATH` resolves to `/app/data/sqlite.db` and `nexora-db` volume
  is mounted at `/app/data`.

## 4. Boot smoke (clean host)

```bash
docker compose up --build -d
docker compose logs backend | grep -E "(integrity|license|plugin)" | head -20
```

- [ ] `[integrity] OK build=… files=…` appears (or `SKIPPED (dev mode)`
  if `NEXORA_DEV_SKIP_INTEGRITY=true` — production should never see this).
- [ ] `[license] valid …` appears with the right customer email.
- [ ] Every expected paid plugin logs as loaded; no "integrity degraded"
  reasons in `globalThis.__nexora_plugins`.

## 5. Admin login + xpub

- [ ] `ADMIN_PASSWORD` (or `ADMIN_PASSWORD_HASH`) was rotated from the
  default `change-me`. A customer who keeps the default is a P0 incident
  waiting to happen.
- [ ] Log in at `https://<domain>/admin`. Confirm:
  - dashboard renders without errors
  - Settings → Litecoin XPub field is set to the customer's REAL xpub
  - "first derived address (index 0)" matches the customer's wallet
- [ ] `GET /api/admin/system/health` returns `integrity.ok=true` and
  `integrity.degraded=false`.

## 6. Checkout smoke (testnet OR <$1 mainnet)

- [ ] Create a $1 test product with 1 key in inventory.
- [ ] Place an order as a guest, pay the exact LTC amount.
- [ ] Watcher logs `paid` within 2 confirmations; key is delivered to
  the order page; email (if enabled) is sent exactly once.
- [ ] Idempotency check (no admin re-mark-paid route exists in v1.1, so
  exercise the recovery path instead): `docker compose restart backend`
  immediately after the order flips to `paid` — boot logs show
  `recoverStuckOrders()` run; the order stays `paid`, no duplicate keys
  are issued, `product.sold` did not increment a second time.

## 7. Backup drill

- [ ] Take a manual backup (see `docs/PRODUCTION.md` → Backup & Restore).
- [ ] Copy the backup off-host (S3, B2, rsync target, etc).
- [ ] On a SCRATCH path, restore it and run `sqlite3 /scratch/db ".tables"`
  — must list every expected table (users, products, orders, etc).
- [ ] A backup nobody has tested is not a backup.

## 8. Rollback plan

- [ ] Previous image tag is still tagged in the registry / local docker.
- [ ] Previous manifest + `.license` are saved alongside the rollback image.
- [ ] Documented procedure to revert:
  ```bash
  docker compose stop
  docker tag nexora-paid:<old> nexora-paid:current
  # restore /app/data/sqlite.db from last good backup (see step 7)
  docker compose up -d
  ```

## 9. Ship

- [ ] Send the customer:
  - `nexora-paid-cus_NNNN.tar.gz` (image + manifest)
  - `nexora-cus_NNNN.license`
  - `docs/DEPLOYMENT.md` link
  - hash of the tarball (`sha256sum`) over a separate channel
- [ ] Record in your ops log: customer id, build id, license expiry,
  tarball sha256, shipped-at timestamp.

---

**Stop conditions** — abort the release if:
- any `*-test*` script exits non-zero
- `[integrity]` logs anything other than OK on the clean smoke boot
- `ADMIN_PASSWORD` is still `change-me`
- xpub first-address does not match the customer's wallet
- the backup drill (§7) fails for any reason