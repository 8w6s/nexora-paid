# Customer Onboarding (Nexora Paid, v1.1)

This is the doc the customer reads on day one. Maintainer-side runbooks
live in [`LICENSE_OPS.md`](LICENSE_OPS.md) and
[`DEPLOYMENT.md`](DEPLOYMENT.md); this one is what we ship to the buyer.

The flow has three actors:

1. **You (maintainer)** — issue the license, mint the GHCR access token,
   tell the customer which image tag to pull.
2. **Customer host** — runs Docker + the supplied `docker-compose.yml`.
3. **End users** — buy stuff from the storefront; never touch any of the
   below.

---

## 1. What the customer receives

A single ZIP (or git bundle) containing:

- `docker-compose.yml` — uses the per-customer GHCR image.
- `.env.example` — the template documented below.
- `license.lic` — signed by our ed25519 key, valid for THIS customer only.
- `nexora-go-live-check.sh` — pre-flight script.
- `nexora-backup.sh` + `nexora-restore-drill.sh` + the new
  `nexora-nxs-restore-drill.ts` — drill the recovery path BEFORE you need it.

**What we never share:** our private signing key, anyone else's license,
GHCR tokens for other customers.

---

## 2. `.env` template

Copy `.env.example` to `.env` next to `docker-compose.yml` and fill in.
The check-script will refuse to go-live if any of the required values
are missing or look bogus.

```ini
# ── Required ─────────────────────────────────────────────────
NODE_ENV=production
PUBLIC_ORIGIN=https://shop.example.com         # MUST be HTTPS in prod
ORDER_TOKEN_SECRET=                            # openssl rand -hex 32

# Admin bootstrap. Use the HASH variant in prod (argon2id of your pw).
# If you must use plaintext, NEVER use the words "change-me" or "admin12345".
ADMIN_EMAIL=admin@example.com
ADMIN_PASSWORD_HASH=                            # bun run scripts/hash-password.ts

# ── Updater handshake (v1.1+) ────────────────────────────
# Generate ONCE with: openssl rand -hex 32
# MUST be identical on the backend AND updater containers, otherwise
# the in-place /api/admin/update/apply path will refuse with 401.
NEXORA_UPDATER_PSK=

# ── GHCR access (per-customer image) ─────────────────────────
# Personal access token we issue you. Read-only on YOUR image only.
# If you're on the public image, leave both blank.
GHCR_TOKEN=
NEXORA_GHCR_TOKEN=

# ── Optional ─────────────────────────────────────────────────
# Catbox.moe userhash — only set if you want the "Share to catbox"
# button to attach uploads to a deletable account. Anonymous works too.
CATBOX_USERHASH=

# Trust proxy headers (X-Forwarded-For) — only if you have a real
# reverse proxy in front (nginx, Caddy, Cloudflare). Default false.
TRUST_PROXY=false

# Email — required only if you turn on order receipts / password reset.
SMTP_HOST=
SMTP_PORT=587
SMTP_USER=
SMTP_PASS=
SMTP_FROM="Your Store <noreply@example.com>"
```

> ⚠ `NEXORA_UPDATER_PSK` lives in BOTH containers. Set it in `.env` AND
> ensure your `docker-compose.yml` passes it to both `backend` and
> `updater` services via `environment:`. A length mismatch between
> the two = silent failure of every update attempt.

---

## 3. First-run sequence

```bash
# 1. Log in to GHCR with the token we issued you.
echo "$GHCR_TOKEN" | docker login ghcr.io -u <your-github-handle> --password-stdin

# 2. Pull the image tag we sent you in the welcome email.
#    Example: ghcr.io/8w6s/nexora-cus001:1.1.0
docker compose pull

# 3. Place license.lic into the data volume BEFORE first boot.
#    The container expects it at /data/app/license.lic.
mkdir -p ./data/app
cp license.lic ./data/app/license.lic

# 4. Bring the stack up.
docker compose up -d

# 5. Wait for healthcheck (about 10-20 seconds on first boot).
docker compose ps

# 6. Pre-flight verdict.
bash scripts/nexora-go-live-check.sh
```

If `nexora-go-live-check.sh` exits with FAIL, fix every FAIL row before
pointing real DNS at the host. WARN rows are recoverable post-launch but
worth resolving.

---

## 4. Day-two operations

### Updating to a new release

In the admin UI under **System → Update**:

1. Click **Check for updates** — the backend queries our FileServer
   and compares the latest release against your current `APP_VERSION`.
2. (Optional but recommended) Click **Prepare** — `docker pull`s the
   next image in the background. The pull is the slowest step; doing it
   here means the eventual swap only restarts the container.
3. Click **Apply** — the updater snapshots `/data` (encrypted, NXS1
   format), pulls (no-op if step 2 ran), swaps versions, healthchecks,
   and rolls back automatically if the healthcheck fails.

The snapshot lands at `/var/backups/nexora/<version>-<ts>.nxs`. Snapshots
are bound to your machine + your license; moving the file to another
host won't decrypt without our help.

### Issuing your own backup drill

Once a quarter (per [`RELEASE_CHECKLIST.md`](RELEASE_CHECKLIST.md) §7):

```bash
# Plain SQLite backup
bash scripts/nexora-backup.sh
bash scripts/nexora-restore-drill.sh /var/backups/nexora/db-*.db

# Encrypted snapshot (the one that actually matters)
bun run scripts/nexora-nxs-restore-drill.ts \
  /var/backups/nexora/<version>-<ts>.nxs
```

The encrypted-snapshot drill is the important one — it proves your
license + your machine-id can decrypt your own snapshots. A snapshot
nobody has decrypted is not a snapshot.

### Rotating secrets

| Secret               | When to rotate                         | How                                                                 |
|----------------------|----------------------------------------|---------------------------------------------------|
| `ORDER_TOKEN_SECRET` | Suspected leak; or yearly hygiene      | Set new value, restart backend; existing guest-order links break    |
| `NEXORA_UPDATER_PSK` | Same                                   | Update env on BOTH containers, restart both, verify with go-live    |
| `GHCR_TOKEN`         | Maintainer rotates per-customer        | We email you a new token; `docker login` again, then `compose pull` |
| `license.lic`        | Maintainer (renewals / feature change) | Drop the new file into `/data/app/license.lic`, restart backend     |
| `CATBOX_USERHASH`    | Catbox dashboard says so               | Set env, restart backend                                            |

### Asking for support

Run `scripts/tui` and press **s** to save a `nexora-support-*.txt` bundle
(system info, license metadata, last 100 log lines, sanitized env).
Email it to support — the file never includes secrets, just the values
the go-live check inspects.

---

## 5. What NOT to do

- Don't commit `.env`, `license.lic`, or `/data/` to a public repo.
- Don't share your GHCR token; it's read-bound to YOUR image alone.
- Don't move `/data` to a different host without asking us first —
  the machine-id binding will invalidate all snapshots and your admin
  may need a license-side fix.
- Don't run `docker compose down -v` casually — `-v` removes the data
  volume. Use `down` without `-v` for restarts.
- Don't disable the updater handshake "to debug" — set `NEXORA_UPDATER_PSK`
  to the same value on both sides instead.

---

## 6. Where to look when something breaks

| Symptom                          | First place to look                                                          |
|----------------------------------|------------------------------------------------------------------------|
| Storefront empty                | Admin → Products: any rows? `active=1`? Stock available?                     |
| Checkout returns NO_WALLET       | Admin → Settings → Payments: LTC xpub set (Ltub/Mtub/zpub prefix)?           |
| Checkout returns NO_STOCK        | Admin → Products → Keys: any keys with `status=available`?                   |
| `/api/health/deep` `db.ok=false` | Disk full? WAL file locked? Check container logs.                            |
| Update apply rolls back          | Container logs for `[updater]`. New image may have failed `/api/health/deep`.|
| 401 on `/api/admin/update/apply` | PSK mismatch between containers. Re-run go-live check.                |

Full deployment + production-tuning reference:
[`DEPLOYMENT.md`](DEPLOYMENT.md), [`PRODUCTION.md`](PRODUCTION.md).