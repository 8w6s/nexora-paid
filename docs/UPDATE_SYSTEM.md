# Auto-Update System

How Nexora delivers updates to self-hosted customers without you (the
maintainer) ever touching their server.

## Architecture (one-page)

```
┌─ You ──────────────────────────────────────────┐
│  Repo: nexora-paid (private)                    │
│    git tag v1.2.3 → push                        │
│  GitHub Actions:                                │
│    1. build & push 4 images to GHCR             │
│       - nexora-backend:1.2.3                    │
│       - nexora-frontend:1.2.3                   │
│       - nexora-updater:1.2.3                    │
│       - nexora-fileserver:1.2.3                 │
│    2. write versions/stable.json + changelog    │
│       into the nexora-releases repo (public)    │
│    3. cut a GitHub Release                      │
└────────────────────────┬───────────────────────┘
                         │
                ┌────────▼─────────┐
                │  FileServer       │  ← runs on your infra
                │  (public image)   │     reads from nexora-releases
                │  GET /v1/version  │
                │  POST /v1/license │
                └────────┬─────────┘
                │
┌────────────────────────▼─────────────────────────┐
│ Customer's self-hosted Nexora                │
│   Admin → Overview → "Updates" card               │
│     1. Click "Check now"  ──► FileServer /version │
│     2. Click "Apply update":                      │
│        backend → unix socket → updater container  │
│        updater:                                   │
│          a. snapshot nexora-db volume → tarball   │
│          b. docker pull new image                 │
│          c. compose up -d (no-deps backend+front) │
│          d. healthcheck /api/health (60s)         │
│          e. ROLLBACK to previous tag if unhealthy │
└──────────────────────────────────────────────────┘
```

## Data safety guarantees

| Guarantee | How |
|---|---|
| Customer DB never replaced | SQLite lives in `nexora-db` volume mounted at `/app/data`. Images contain code only. |
| `.env` / `.keys/` / `nexora.license` survive | Bind-mounted from host or in named volumes; updater never touches them. |
| No half-applied schema | Each migration runs in one transaction (existing). |
| No downgrade after migrate | `assertNoDowngrade()` in `backend/src/db/connection.ts` refuses boot if `dbMax > SCHEMA_VERSION`. |
| Pre-update snapshot | Updater tars the entire DB volume to `nexora-backups` before pull. |
| Auto rollback | If new backend fails 60s healthcheck, updater re-pins old tag + compose up. |
| Concurrency safe | One job at a time per updater process; second `/apply` returns 409. |
| Version drift safe | UI sends `expectVersion`; updater 409s if FileServer published a newer one between Check + Apply. |

## Files in this design

| Path | Role |
|---|---|
| `backend/src/lib/app-version.ts` | `APP_VERSION` + `SCHEMA_VERSION` (single source of truth) |
| `backend/src/db/connection.ts` | `assertNoDowngrade()` |
| `backend/src/routes/admin-update.ts` | `/api/admin/update/{check,apply,status}` |
| `updater/` | Host-side updater container (Docker socket + nexora-db ro) |
| `fileserver/` | Public version + license verify service |
| `docker-compose.yml` | Base stack (caddy + backend + frontend) |
| `docker-compose.updater.yml` | Overlay enabling in-place updates |
| `.github/workflows/release.yml` | On `v*` tag: build 4 images + write releases repo |
| `.env.version` | `NEXORA_VERSION=1.2.3` — rewritten by updater on apply |

## Operator setup (customer's side, one-time)

```bash
# Public domain mode (recommended)
DOMAIN=shop.example.com ADMIN_EMAIL=you@example.com \
  docker compose \
    -f docker-compose.yml \
    -f docker-compose.updater.yml \
    up -d
```

That's it. From then on every update is a button-click in the admin UI.

## Maintainer setup (you, one-time)

1. **Create `nexora-releases` public repo**
   ```
   versions/
     stable.json    ← rewritten by CI on every release
   changelog/
     1.0.0.md       ← rewritten by CI
     1.0.1.md
   revoked.json     ← maintained by hand: { "revoked": ["lic-id-1"] }
   ```

2. **Configure repo variables** in `nexora-paid`:
   - `NEXORA_RELEASES_REPO` = `you/nexora-releases`
   - `RELEASES_REPO_TOKEN` (secret) = PAT with `contents:write` on `nexora-releases`

3. **Deploy `nexora-fileserver` once** somewhere reachable (Fly.io / Render / your VPS).
   Customers point their `NEXORA_FILESERVER_URL` env at it.

4. **Cut a release**:
   ```bash
   git tag v1.2.3
   git push origin v1.2.3
   ```
   Actions builds + publishes + writes the manifest. Customers see the update
   within 5 minutes (FileServer cache TTL).

## License revocation

To revoke a leaked license, hand-edit `revoked.json` in `nexora-releases`:

```json
{ "revoked": ["lic-2025-0042"] }
```

The customer's installation calls FileServer at boot + every 24h. Once it
sees the licenseId in the revoked list, paid features disable on next boot
(license still verifies cryptographically — revocation is an extra check).

## Air-gap fallback

Customers without internet can still verify the license offline (ed25519
verify in `backend/src/lib/license.ts`) — they just can't auto-update.
They download the new image tarball, `docker load`, edit `.env.version`,
and `docker compose up -d` manually. The snapshot/rollback flow can be
run by hand via `scripts/nexora-backup.sh`.