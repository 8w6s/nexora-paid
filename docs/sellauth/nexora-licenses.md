# Nexora — Your storefront, your rules

Nexora is a self-hosted alternative to SellAuth, Sellix, and Shoppy — built for crypto-native sellers who refuse to give 5% of every sale to a middleman.

Run it on a $5 VPS. Accept Litecoin directly into your own HD wallet. Ship digital keys, files, or accounts automatically. Zero platform fees, forever.

## What you get

- **Native Litecoin checkout** — BIP32 HD wallet, on-chain confirmation, no third-party processor
- **Astro 5 + React 19 storefront** — fast, SEO-friendly, mobile-first
- **Full admin panel** — products, categories, coupons, orders, customers, analytics, support tickets
- **Plugin system** — search suggestions, bulk admin tools, CSV export, customer export
- **In-place auto-update** — one click in admin, with encrypted DB snapshot + auto-rollback
- **Hardened by default** — Docker `cap_drop ALL`, `no-new-privileges`, signed integrity manifest, Ed25519 license verification
- **Light + dark theme**, multi-language storefront

## How licensing works

- One license per shop instance.
- Updates are gated by your license window (see options below).
- The license never expires the app itself — even after the update window closes, your shop keeps running on the last version forever.

## Update tier options

- **6 months** — $79 — 6 months of updates
- **1 year** — $129 — 12 months of updates
- **Lifetime** — $249 — updates forever

Pick the option that fits how long you plan to run the shop. You can always renew later — your data stays untouched.

## One-command install

```bash
curl -fsSL https://raw.githubusercontent.com/8w6s/nexora-releases/main/install/setup.sh | bash
```

That's it. The script auto-generates secrets, pulls your per-invoice image, and walks you through admin setup in a browser.

## Tech specs

- Bun + Elysia + SQLite backend (one binary, no external DB needed)
- Astro 5 SSR + React 19 frontend
- Docker Compose stack (backend + frontend + Caddy auto-HTTPS)
- Hardware: 1 vCPU / 512 MB RAM / 10 GB disk minimum

## Delivery

You receive within 5 minutes of payment:

- Per-invoice Docker image (your invoice id baked in for traceability)
- Signed `.license` file (Ed25519, watermarked with your email)
- Install instructions via email

## Support

- Discord access for questions
- Best-effort response within 48h
- Source-available for inspection (not open source — license-gated)