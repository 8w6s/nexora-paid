# Nexora — Digital goods store (Litecoin)

International digital-goods shop. English UI, USD pricing, **Litecoin** payment via an HD wallet (xpub),
real key inventory, automatic on-chain payment detection, customer accounts, admin dashboard.

- **Backend:** Elysia + Bun + Drizzle + SQLite
- **Frontend:** Astro 5 (SSR, `@astrojs/node`) + React islands

## Run locally (one command)

```bash
bun install        # once, at the repo root
bun run dev         # starts backend :3000 AND frontend :4321 together
```

Open **http://localhost:4321**. Other scripts: `bun run dev:backend`, `bun run dev:frontend`, `bun run seed`.

First boot seeds 10 demo products (USD) + 210 demo keys. Admin: **admin@nexora.local / admin12345** (`/login`, then `/admin`).

## Run with Docker

The stack ships with a Caddy reverse proxy in front of backend + frontend, so
you only expose **one port** and HTTPS is handled automatically.

```bash
# Local / dev — http://localhost
docker compose up --build

# Production with auto-HTTPS (Let's Encrypt)
DOMAIN=shop.example.com ADMIN_EMAIL=you@example.com \
ADMIN_PASSWORD=strong-pass \
docker compose up -d --build

# Cloudflare Tunnel (no open ports, behind NAT/CGNAT)
CLOUDFLARE_TUNNEL_TOKEN=eyJh... \
docker compose --profile tunnel up -d --build
```

Copy `.env.example` → `.env` for full config. SQLite persists in `nexora-db`
volume; certs in `caddy-data`. See **[DEPLOYMENT.md](docs/DEPLOYMENT.md)** for the three modes in detail.

## Before selling for real

1. **Admin → Settings → paste your real Litecoin xpub** (Ltub / Mtub / zpub — public key only).
   Verify the shown *first address* matches your wallet. *(Default is a TEST key — do not receive funds on it.)*
2. **Change the admin password** (`ADMIN_PASSWORD` / `ADMIN_PASSWORD_HASH` in `backend/.env`).
3. (Optional) Register a free **BlockCypher token** → settings `blockcypher_token` for higher rate limits.
4. (Optional) Enable **email**: install `resend` or `nodemailer` and configure provider in Admin → Settings.
5. Add real product key inventory: **Admin → Products → Keys** (one code per line).
6. Set `NODE_ENV=production` (enables Secure cookies — requires HTTPS) and a real `PUBLIC_ORIGIN`.

## How payment works

USD price → locked LTC rate (Kraken→Coinbase) at checkout → unique HD child address per order →
background watcher polls BlockCypher (fallback litecoinspace.org) → on enough confirmations (default 2)
the order is marked paid and real keys are delivered (idempotent, survives restarts).

## Tests

```bash
bun --cwd backend src/lib/hd.test.ts    # HD address derivation (19 checks)
bun run dev                             # then, with the server up:
bun --cwd backend src/e2e.test.ts       # full backend e2e (17 checks)
```

## Documentation

- **[CLUSTERS.md](docs/CLUSTERS.md)** — Feature roadmap (Cluster A/F done, Cluster C planned)
- **[PLUGIN_DEV.md](docs/PLUGIN_DEV.md)** — How to build plugins (manifest, register, hooks, migrations, testing)
- **[LICENSE_ROTATION.md](docs/LICENSE_ROTATION.md)** — License security, key rotation, incident response
- **[PRODUCTION.md](docs/PRODUCTION.md)** — Pre-launch checklist, scalability, monitoring, backups
- **[DEPLOYMENT.md](docs/DEPLOYMENT.md)** — Docker & standalone setup
- **[MIGRATION_POSTGRES.md](docs/MIGRATION_POSTGRES.md)** — SQLite → PostgreSQL migration guide
- **[ARCHITECTURE.md](../nexora/docs/ARCHITECTURE.md)** — Payment flow, HD wallet, state machine (shared with Free)

See `../nexora/docs/UPGRADE_PLAN_V2.md` for full V2 roadmap architecture.
