# Production Deployment Guide (Paid)

How to safely deploy Nexora Paid with licensing, plugin system, and real Litecoin payments.

## Pre-Launch Checklist

### 1. License Setup

- [ ] Obtain `.license` file (JSON with ed25519 signature)
  - Place at `./nexora.license` (or set `LICENSE_FILE` env var)
  - Format: `{"payload": {"email": "...", "productId": "nexora-paid", ...}, "signature": "..."}`
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

- [ ] Change `ADMIN_PASSWORD` from default `admin12345`
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

- [ ] SQLite file persists in volume (Docker) or project root
- [ ] **Backup strategy**: copy `sqlite.db` to external storage (S3, daily)
  ```bash
  0 2 * * * cp /app/sqlite.db /tmp/db-backup-$(date +%s).db && aws s3 cp /tmp/db-backup-*.db s3://my-backups/
  ```
- [ ] Test restore: verify `sqlite3 /path/to/backup.db ".tables"` works
- [ ] **Retention**: keep 7–30 days backups

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

- [ ] **Error logs**: `docker logs nexora | grep -i "error\\\\|warn"`
- [ ] **Watcher health**: Admin → Orders → filter `status=pending`, check age
  - If > 2 hours old: watcher likely failed
- [ ] **Database size**: `ls -lh sqlite.db`
- [ ] **Uptime**: monitor server restarts

## Incident Response

### Payment Watcher Stuck

**Symptoms**: Orders in `pending` > 1 hour, no progress

**Recovery**:
1. Check logs: `docker logs nexora | tail -50`
2. Verify BlockCypher: `curl https://api.blockcypher.com/v1/ltc/main/`
3. Verify network: `ping blockcypher.com`
4. Restart watcher: `docker restart nexora`
5. Manual override: Admin → Orders → [order] → Mark Paid

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

### Automated Daily Backup

```bash
#!/bin/bash
BACKUP_DIR="/backups/nexora"
mkdir -p $BACKUP_DIR
cp /app/sqlite.db $BACKUP_DIR/db-$(date +%Y-%m-%d_%H%M%S).db
find $BACKUP_DIR -name "db-*.db" -mtime +30 -delete
```

### Manual Restore

```bash
docker compose down
cp /backups/nexora/db-2026-06-07.db ./sqlite.db
docker compose up -d
```

---

**See also**:
- DEPLOYMENT.md: Docker setup
- PLUGIN_DEV.md: managing plugins
- LICENSE_ROTATION.md: licensing incidents