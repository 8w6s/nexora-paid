# Deployment Guide (Paid)

Three-mode Docker stack with Caddy reverse proxy + automatic HTTPS.
**No manual nginx, no certbot, no port-forwarding hassle.**

## TL;DR

| Mode | Use case | Command |
|------|----------|---------|
| **Local / Dev** | Try it out, develop | `docker compose up` |
| **Public domain** | Production, you own a domain | `DOMAIN=shop.example.com ADMIN_EMAIL=you@example.com docker compose up -d` |
| **Cloudflare Tunnel** | Behind NAT/CGNAT, no open ports | `docker compose --profile tunnel up -d` |

The stack:

```
       ┌────────────────┐
       │   Caddy :80/:443 │ ← auto Let's Encrypt
       └────────┬─────────┘
                │
        ┌───────┴────────┐
        │                │
  /api/* → backend     /* → frontend
   (Bun :3000)        (Astro SSR :4321)
```

---

## Mode 1 — Local / Dev

```bash
cp .env.example .env       # optional; defaults are fine for local
docker compose up --build
```

Open <http://localhost> — Caddy serves on port 80 with no TLS.
Admin: `admin@nexora.local` / value of `ADMIN_PASSWORD` (default `change-me`).

> SQLite data persists in the `nexora-db` volume. To reset:
> `docker compose down -v`

---

## Mode 2 — Public domain with auto-HTTPS

### Prerequisites

1. A domain whose DNS A/AAAA record points to this server.
2. Ports **80 and 443** reachable from the internet (Let's Encrypt needs port 80 for the HTTP-01 challenge).

### Steps

```bash
cp .env.example .env
```

Edit `.env`:
```env
DOMAIN=shop.example.com
ADMIN_EMAIL=you@example.com
PUBLIC_ORIGIN=https://shop.example.com
PUBLIC_SITE_URL=https://shop.example.com
ADMIN_PASSWORD=a-strong-passphrase
```

Bring it up:
```bash
docker compose up -d --build
```

First request triggers Let's Encrypt issuance (~10s). Subsequent renewals are
automatic — Caddy stores certs in the `caddy-data` volume.

> **Do not delete `caddy-data`** — repeated re-issuance can hit Let's Encrypt rate limits (5 certs / 7 days per domain).

### Verify

```bash
docker compose logs -f caddy   # look for "certificate obtained successfully"
curl -I https://shop.example.com
```

---

## Mode 3 — Cloudflare Tunnel (no port forwarding)

For self-hosters behind CGNAT, dynamic IP, or who simply don't want to expose
ports. Cloudflare terminates TLS; the tunnel forwards to Caddy on the internal
network.

### Steps

1. Cloudflare dashboard → **Zero Trust → Networks → Tunnels → Create tunnel**.
2. Name it (e.g. `nexora`), copy the **tunnel token**.
3. In the same UI, add a **public hostname** route:
   - Subdomain: `shop`
   - Domain: `example.com`
   - Service: `HTTP`  →  `caddy:80`
4. On your server:

   ```env
   CLOUDFLARE_TUNNEL_TOKEN=eyJh...long-token
   DOMAIN=shop.example.com
   PUBLIC_ORIGIN=https://shop.example.com
   PUBLIC_SITE_URL=https://shop.example.com
   ADMIN_PASSWORD=a-strong-passphrase
   ```

5. Launch with the `tunnel` profile:

   ```bash
   docker compose --profile tunnel up -d --build
   ```

You can now `docker compose down` Caddy's exposed ports if you want — they're
not needed when traffic comes via the tunnel. (They're harmless if left open.)

---

## Standalone Bun (no Docker)

```bash
bun install
cp backend/.env.example backend/.env       # edit as needed
bun run dev                  # both servers on :3000 and :4321
```

Production:

```bash
NODE_ENV=production bun --cwd backend src/index.ts
NODE_ENV=production bun --cwd frontend node ./dist/server/entry.mjs
```

Put any reverse proxy of choice in front (Caddy, nginx, Traefik). Routes:
- `/api/*`, `/health`, `/admin/api/*` → backend `:3000`
- everything else → frontend `:4321`

---

## Backups

```bash
# Snapshot — uses SQLite's atomic online-backup API so the WAL/SHM sidecars
# stay consistent under live writes. `cp sqlite.db` alone corrupts the
# snapshot if the watcher commits mid-copy.
docker compose exec -T backend sqlite3 /app/data/sqlite.db \
  ".backup /app/data/backup.db"
docker cp $(docker compose ps -q backend):/app/data/backup.db \
  ./backup-$(date +%F).db
docker compose exec -T backend rm /app/data/backup.db

# Restore — stop the writer first, replace the main file, and delete the
# old WAL/SHM (they reference old page IDs and refuse to open the new file).
docker compose stop backend
docker cp ./backup-$(date +%F).db \
  $(docker compose ps -q backend):/app/data/sqlite.db
docker compose run --rm --no-deps backend \
  sh -c "rm -f /app/data/sqlite.db-wal /app/data/sqlite.db-shm"
docker compose start backend
```

See `docs/PRODUCTION.md` for hourly cron + offsite retention.

> A built-in admin **Backup / Restore** UI is on the roadmap (Phase 2.2).

---

## Troubleshooting

| Symptom | Likely cause | Fix |
|---------|------------|-----|
| Browser shows ERR_CONNECTION_REFUSED | Caddy not running or port 80/443 blocked | `docker compose ps caddy`; check firewall |
| "no certificate available" in logs | Port 80 not reachable from internet | Open port 80; verify with `curl -v http://YOUR_IP` from outside |
| `cloudflared` exits immediately | Bad `CLOUDFLARE_TUNNEL_TOKEN` | Re-copy from CF dashboard |
| API calls 404 from browser | Stale frontend build cached old `PUBLIC_API_ORIGIN` | `docker compose build --no-cache frontend` |
| HTTPS works but mixed-content warnings | `PUBLIC_ORIGIN` still `http://...` | Set both `PUBLIC_ORIGIN` and `PUBLIC_SITE_URL` to `https://...` |

---

## See also

- **PRODUCTION.md** — security checklist, monitoring, scaling.
- **LICENSE_ROTATION.md** — license + xpub rotation.
- **CLUSTERS.md** — feature roadmap.