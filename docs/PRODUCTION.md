# Production Deployment Guide (Paid)

How to safely deploy Nexora Paid with licensing, plugin system, and real Litecoin payments.

## Pre-Launch Checklist

### 1. License Setup

- [ ] Obtain `.license` file (JSON with ed25519 signature)
  - Place at `./nexora.license` (or set `LICENSE_FILE` env var)
  - Format: `{"payload": {"email": "...", "productId": "nexora-paid", ...}, "signature": ".."}`
- [ ] Verify on boot: `[plugin] license valid (your@email.com)`
- [ ] If missing: plugins won't load (app runs as Free version)

### 2. Litecoin Wallet Setup

- [ ] Generate/import extended public key (xpub) from your wallet
  - Format: `Ltub` (P2PKH), `Mtub` (P2SH-P2WPKH), or `zpub` (P2WPKH)
- [ ] Paste xpub into Admin → Settings → Litecoin XPub
- [ ] Verify: Admin → Settings displays first derived address (index 0)
- [ ] **Critical**: test on testnet first; confirm address matches wallet
- [ ] Switch to mainnet xpub before accepting real payments

### 3. Admin & Security

- [ ] Change `ADMIN_PASSWORD` from default `change-me` (production refuses to boot with plaintext — set `ADMIN_PASSWORD_HASH` to an argon2id hash and unset `ADMIN_PASSWORD`)
  ```bash
  # Generate strong password + hash
  openssl rand -base64 24
  bun -e "console.log(await Bun.password.hash('your-password'))"
  # Paste hash into ADMIN_PASSWORD_HASH in backend/.env
  ```
- [ ] Set `NODE_ENV=production` (enables Secure cookies)
- [ ] Set `PUBLIC_ORIGIN=https://yourdomain.com`
- [ ] Remove demo data before going live

### 4. HTTPS & Cookies

- [ ] Obtain SSL certificate (Let's Encrypt)
- [ ] Configure reverse proxy (nginx/Caddy) for HTTPS
- [ ] Secure cookie requires HTTPS; HTTP logins will fail

### 5. Database & Backups

- [ ] SQLite file persists in the `nexora-db` named volume at **`/app/data/sqlite.db`** inside the backend container (see `docker-compose.yml` → `DB_PATH`). Project-root checkout uses `backend/sqlite.db` instead.
- [ ] **Backup strategy**: use SQLite's online backup API (NOT `cp`) so WAL/SHM sidecars stay consistent under live writes:
  ```bash
  # Hourly cron on the host. The backend container runs sqlite3 against the
  # mounted volume; `.backup` is atomic + WAL-safe — `cp sqlite.db` alone
  # corrupts the snapshot if the watcher commits mid-copy.
  0 * * * * docker compose exec -T backend sqlite3 /app/data/sqlite.db \
    ".backup '/app/data/backup-$(date +\%Y\%m\%d-\%H).db'" && \
    docker cp $(docker compose ps -q backend):/app/data/backup-$(date +\%Y\%m\%d-\%H).db \
      /var/backups/nexora/ && \
    aws s3 cp /var/backups/nexora/backup-$(date +\%Y\%m\%d-\%H).db s3://my-backups/nexora/
  ```
- [ ] **Test restore quarterly** — pick a backup, restore to a scratch path, run `sqlite3 /scratch/backup.db ".tables"` and verify product/order counts match a known-good snapshot. A backup nobody has tested is not a backup.
- [ ] **Retention**: keep 7 days hourly + 30 days daily + 12 months monthly.

### 6. Payment Processing

- [ ] (Optional) Register BlockCypher token → increases rate limits
  - Free: ~100 req/hr; Registered: ~500+ req/hr
  - Add token to Admin → Settings
- [ ] Verify watcher cadence: Admin → Settings → Payment Watcher
  - Default: every 30 seconds
  - Monitor logs for explorer API errors

### 7. Email (Optional)

- [ ] If enabling transactional email:
  - Resend: https://resend.com/ (get API key)
  - SMTP: configure host/port/user/password
  - Add to Admin → Settings → Email Configuration
  - Test send from Admin
- [ ] If disabled: keys visible in customer My Orders (best-effort)

### 8. Product Inventory

- [ ] Add real product keys: Admin → Products → Keys (one per line)
- [ ] Test checkout: buy a product, verify key delivery
- [ ] Confirm keys appear in Admin → Orders

### 9. Plugins

- [ ] Verify all plugins loaded: boot logs should show
  ```
  [plugin] ✓ search-suggest@1.0.0 — Storefront search autocomplete
  [plugin] ✓ admin-bulk@1.0.0 — Bulk operations
  [plugin] ✓ admin-export@1.0.0 — CSV export
  [plugin] ✓ admin-customers-csv@1.0.0 — Customer export
  ```
- [ ] Disable any plugins not needed: Admin → Settings → Features → toggle
- [ ] Test each: search autocomplete, bulk delete, CSV export

## Scalability Considerations

### SQLite Limits

- **Concurrent writes**: entire DB locked; reads parallel
- **Recommended**: < 1000 concurrent pending orders
- **Migration path**: if exceeding, migrate to PostgreSQL (same Drizzle schema)

### Watcher Tuning

- **Current cadence**: ~350ms sleep between BlockCypher requests
- **Rate limits**: free ~100–200 req/hr; registered token ~500+ req/hr
- **If 429 errors**: register token + increase sleep interval in `backend/src/lib/watcher.ts`

### Monitoring Checklist

- [ ] **Error logs**: `docker compose logs backend | grep -iE "ERROR|WARN"`
- [ ] **Watcher health**: Admin → Orders → filter `status=pending`, check age
  - If > 2 hours old: watcher likely failed
- [ ] **Database size**: `docker compose exec -T backend ls -lh /app/data/sqlite.db`
- [ ] **Integrity status**: `curl -s -b admin-cookie http://localhost/api/admin/system/health | jq .integrity`
- [ ] **Uptime**: monitor server restarts

## Incident Response

### Payment Watcher Stuck

**Symptoms**: Orders in `pending` > 1 hour, no progress

**Recovery**:
1. Check logs: `docker compose logs backend --tail=50 | grep -E "watcher|explorer"`
2. Verify BlockCypher reachable: `curl -sS https://api.blockcypher.com/v1/ltc/main/`
3. If primary fails, the watcher auto-falls-back to litecoinspace.org — confirm: `curl -sS https://litecoinspace.org/api/blocks/tip/height`
4. Verify network from inside the container: `docker compose exec backend wget -qO- https://api.blockcypher.com/v1/ltc/main/`
5. Restart the backend service only (not the whole stack — Caddy + frontend keep serving): `docker compose restart backend`. The watcher is DB-driven, so `recoverStuckOrders()` runs on boot and resumes idempotently.
6. **No "mark paid" admin route exists in v1.1** — manual force-paid is a planned v1.2 feature. If a customer claims they paid but the watcher disagrees, verify on-chain (`https://litecoinspace.org/address/<ltcAddress>`) and either wait for confirmations or hand-edit the DB row in a maintenance window after taking a backup.

### License Invalid

**Symptoms**: Boot logs show `[plugin] license invalid (reason); skipping all plugins`

**Recovery**:
1. Verify `.license` file exists and is valid JSON
2. Check signature matches public key in code
3. Re-issue license if needed (see LICENSE_ROTATION.md)
4. Restart server

### Customer Lost Access

**Cause**: session expired or cookie issues

**Recovery**:
- Customer logs out, clears cookies, logs back in
- Check: is HTTPS enabled? (Secure flag requires https://)
- Check: does `PUBLIC_ORIGIN` match domain?

## Backup & Restore

### Why `sqlite3 .backup` and not `cp`

The backend runs SQLite in WAL mode (see `backend/src/db/connection.ts` →
`PRAGMA journal_mode = WAL`). A bare `cp sqlite.db` copies only the main
file, missing in-flight writes still sitting in `sqlite.db-wal` and
`sqlite.db-shm`. The watcher commits every ~30s, so a copy at the wrong
instant snapshots a half-written transaction and the restored DB will
fail to open. `sqlite3 .backup` uses the online backup API which is
atomic with respect to live writers — always use it.

### Automated hourly backup (host crontab)

The repo ships `scripts/nexora-backup.sh` — copy it to the host (NOT inside
the container) and wire it into cron:

```bash
sudo cp scripts/nexora-backup.sh /usr/local/bin/nexora-backup.sh
sudo chmod +x /usr/local/bin/nexora-backup.sh

# crontab -e (root or a user in the docker group)
0 * * * * /usr/local/bin/nexora-backup.sh >> /var/log/nexora-backup.log 2>&1
```

The script:
- Uses SQLite's online `.backup` API (atomic + WAL-safe) — never `cp`.
- Verifies the on-host snapshot opens before declaring success (a backup
  nobody has read is not a backup).
- Bails loud with a non-zero exit if the backend container is not running,
  so cron failure mail surfaces immediately instead of silently skipping.
- Prunes snapshots older than `RETENTION_DAYS` (default 7).

Override via env: `BACKUP_DIR` (default `/var/backups/nexora`),
`RETENTION_DAYS`, `COMPOSE_FILE`.

### Manual restore

```bash
# Stop the backend so no writer holds a lock; leave Caddy + frontend running
# only if you want the maintenance page. For full quiet, `docker compose down`.
docker compose stop backend

# Replace the file on the named volume. Restore to a TEMP path first, sanity-
# check it, then move into place. Never overwrite the live file blindly.
docker compose run --rm --no-deps -v /var/backups/nexora:/restore backend \
  sh -c "sqlite3 /restore/db-2026-06-07_020000.db '.tables' && \
         cp /restore/db-2026-06-07_020000.db /app/data/sqlite.db && \
         rm -f /app/data/sqlite.db-wal /app/data/sqlite.db-shm"

docker compose start backend
docker compose logs --tail=30 backend  # confirm [integrity] OK + watcher resumed
```

Removing the WAL/SHM sidecars is **required** after a restore — they
reference the old main-file's page IDs and will refuse to open against
the restored file. Boot path recreates them from scratch.

### Restore drill (quarterly)

Before trusting a backup in an incident, prove you can open it:

```bash
./scripts/nexora-restore-drill.sh /var/backups/nexora/db-2026-06-23_120000.db
```

The drill copies the snapshot to a scratch path, opens it with `sqlite3`,
checks the core tables exist (`users`, `products`, `orders`, `product_keys`,
`settings`), and prints row counts. Exits non-zero if the file is corrupt,
schema-incomplete, or obviously empty (a fresh-install snapshot archived by
mistake). Run quarterly and after any change to backup or restore procedure.

---

**See also**:
- DEPLOYMENT.md: Docker setup
- PLUGIN_DEV.md: managing plugins
- LICENSE_ROTATION.md: licensing incidents