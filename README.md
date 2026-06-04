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

```bash
ADMIN_PASSWORD=your-strong-pass \
PUBLIC_API_ORIGIN=http://localhost:3000 \
PUBLIC_SITE_URL=http://localhost:4321 \
docker compose up --build
```

SQLite persists in the `nexora-db` volume. (Note `PUBLIC_API_ORIGIN` is baked into the frontend at build time.)

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

See `docs/UPGRADE_PLAN.md` for the full design.
