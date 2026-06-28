# Nexora self-host installer

Spin up a Nexora storefront from a single command on any host.

## Quick start — Linux / macOS / WSL

```bash
curl -fsSL https://raw.githubusercontent.com/8w6s/nexora-install/main/setup.sh | bash
```

You'll be asked for:
- Your invoice id (we gave it to you when you paid)
- Admin email
- Backend / frontend ports (defaults are 3000 + 4321)
- Public origin (defaults to `http://localhost:<frontend-port>`)

Everything else — strong secrets, `.env`, `docker-compose.yml`, image
pull, container start, health check — runs automatically. ~2 minutes.

## Quick start — Windows (PowerShell)

```powershell
irm https://raw.githubusercontent.com/8w6s/nexora-install/main/setup.ps1 | iex
```

PowerShell 5.1 or 7, with Docker Desktop already installed.

## Non-interactive (CI / scripted installs)

Pre-set env vars and `setup.sh` skips every prompt:

```bash
INVOICE=inv_2026_001 \
  ADMIN_EMAIL=you@example.com \
  PUBLIC_ORIGIN=https://shop.example.com \
  HOST_BACKEND_PORT=3000 HOST_FRONTEND_PORT=4321 \
  curl -fsSL https://raw.githubusercontent.com/8w6s/nexora-install/main/setup.sh | bash
```

PowerShell equivalent — pass them as parameters to the script:

```powershell
$params = @{
  Invoice      = 'inv_2026_001'
  AdminEmail   = 'you@example.com'
  PublicOrigin = 'https://shop.example.com'
}
& ([scriptblock]::Create((irm https://raw.githubusercontent.com/8w6s/nexora-install/main/setup.ps1))) @params
```

## Legacy one-liner (no prompts, all env vars)

`install.sh` still exists for fully non-interactive flows:

```bash
curl -fsSL https://raw.githubusercontent.com/8w6s/nexora-install/main/install.sh \
  | INVOICE=inv_2026_001 bash
```

Use this in CI or in scripts you've already templated. The interactive
`setup.sh` is recommended for first-time installs.

## What lands on the host

```
./nexora/
  .env                    ← generated secrets + admin password (chmod 600)
  docker-compose.yml      ← pinned to your per-invoice image
```

Plus one Docker volume named `nexora_nexora-db` holding the SQLite
database. The host filesystem is otherwise untouched.

## Re-running

Both scripts are idempotent:

- `.env` is preserved; only `NEXORA_INVOICE_ID`, `ADMIN_EMAIL`,
  `PUBLIC_ORIGIN`, `NODE_ENV` get updated on re-run.
- Compose file rewritten with the latest image tag.
- Use re-runs to upgrade after we publish a new image, or to rotate
  ports / domains.

## Day-to-day commands

```bash
docker compose -f ./nexora/docker-compose.yml logs -f
docker compose -f ./nexora/docker-compose.yml down
docker compose -f ./nexora/docker-compose.yml pull && \
  docker compose -f ./nexora/docker-compose.yml up -d
```

## Behind a domain + HTTPS

1. DNS A/AAAA record → your host's IP.
2. nginx / Caddy / Cloudflare Tunnel terminates TLS, proxies both
   `:4321` (frontend) and `:3000` (API).
3. Re-run with `PUBLIC_ORIGIN=https://your-domain.example`.

## If something fails

1. `docker compose -f ./nexora/docker-compose.yml logs --tail=80`
2. Check your invoice id matches a `latest-<id>` tag at
   `https://github.com/8w6s?tab=packages` (we mint one per paid customer).
3. Re-run the same `setup.sh` / `setup.ps1` — your `.env` is preserved.
