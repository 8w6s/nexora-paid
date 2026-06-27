# Nexora self-host installer

One-command setup for the Nexora storefront.

## Quick start

```bash
curl -fsSL https://raw.githubusercontent.com/8w6s/nexora-install/main/install.sh \
  | INVOICE=inv_2026_001 bash
```

If your fleet uses a private GHCR namespace, also pass
`TOKEN=ghp_yourPAT` (read:packages). For the default public image, the
token is not required.

That's the whole install. The script:

1. Logs into GHCR with your PAT.
2. Generates `ORDER_TOKEN_SECRET`, `DATABASE_ENCRYPTION_KEY`,
   `NEXORA_LICENSE_SECRET`, and (if you didn't pass one) an admin
   password, saving everything to `./nexora/.env`.
3. Writes `./nexora/docker-compose.yml` pinned to **your** per-invoice
   image `ghcr.io/8w6s/nexora:latest-<your_invoice_id>`.
4. Pulls the image and runs `docker compose up -d`.
5. Waits up to 90 s for `/api/health` and prints the admin URL.

When it's done you'll see:

```
[nexora] Nexora is up.
  Storefront:  http://localhost:4321/
  Admin:       http://localhost:4321/admin
  Email:       admin@nexora.local
  Password:    A4xK....8q     (generated; saved in /root/nexora/.env)
```

## Required inputs

| env var | what it is |
|---|---|
| `INVOICE` | Your invoice id (`inv_2026_001`, given to you when you paid). |
| `TOKEN`   | (optional) GitHub PAT with `read:packages`. Only needed when the Nexora image is private; the default release line is public. |

## Optional inputs

| env var | default | purpose |
|---|---|---|
| `ADMIN_EMAIL`        | `admin@nexora.local` | the email you'll sign in with |
| `ADMIN_PASSWORD`     | random 24-char | preset password instead of letting the installer generate one |
| `HOST_BACKEND_PORT`  | `3000` | host port mapped to the API |
| `HOST_FRONTEND_PORT` | `4321` | host port mapped to the storefront |
| `PUBLIC_ORIGIN`      | `http://localhost:<HOST_FRONTEND_PORT>` | the public URL customers visit (set this when putting Nexora behind a reverse proxy / domain) |
| `INSTALL_DIR`        | `$PWD/nexora` | where `.env` + `docker-compose.yml` are written |
| `NODE_ENV`           | `production` | flip to `development` to relax cookie + CSRF policy |

## Re-running the installer

Re-running is safe — it preserves existing secrets in `./nexora/.env`.
Useful for:

- pulling a newer image (after we bump versions): re-run the same command.
- rotating a leaked PAT: re-run with `TOKEN=<new>`.

## Day-to-day commands

```bash
# follow logs
docker compose -f ./nexora/docker-compose.yml logs -f

# stop
docker compose -f ./nexora/docker-compose.yml down

# manual upgrade (otherwise re-run install.sh)
docker compose -f ./nexora/docker-compose.yml pull
docker compose -f ./nexora/docker-compose.yml up -d
```

## Behind a domain / HTTPS

1. Point a DNS record at the host.
2. Put nginx / Caddy / Cloudflare Tunnel in front of `:4321` (frontend) and
   `:3000` (API) — most setups route both to one subdomain and let the
   frontend proxy `/api/*` internally.
3. Re-run the installer with `PUBLIC_ORIGIN=https://your-domain.example`.

## If something breaks

1. Check container logs first: `docker compose -f ./nexora/docker-compose.yml logs --tail=80`.
2. Confirm your `INVOICE` matches the file at
   `https://github.com/8w6s/nexora-releases/blob/main/invoices/<INVOICE>.json`
   and its `status` is `active`.
3. Confirm your PAT can `docker pull ghcr.io/8w6s/nexora:latest-<INVOICE>`.
4. Reach out and include the log excerpt + the boot banner Nexora printed.