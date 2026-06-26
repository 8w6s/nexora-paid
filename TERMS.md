# Nexora Paid — License & Terms

## What you get

- **Source code** of Nexora Paid (backend + frontend + updater + scripts).
- **License file** (ed25519-signed `.license`) tied to your email — enables paid plugins.
- **12 months of updates** from the date of purchase (access to new releases via the in-app updater or manual download).
- **Email support** (response within 48 business hours, best-effort).
- **One shop / one domain** per license. Multi-domain requires additional licenses.

## Pricing

| Tier | Price | Includes |
|------|-------|----------|
| Standard | $299 one-time | 1 license, 12 months updates + email support |
| Lifetime | $499 one-time | 1 license, lifetime updates, 12 months priority support |
| Renewal (after year 1) | $99/year | Continued updates + email support |

**Early-bird discount**: first 10 buyers get Standard at $199.

**Crypto discount**: pay in LTC/BTC and receive 10% off any tier.

## Refund policy

- **7-day install guarantee**: if you cannot get the stack running with our support within 7 days of purchase, we refund in full (minus payment processor fees if applicable).
- **No refund** once you have:
  - Successfully deployed to production (evidenced by a live domain serving traffic).
  - Issued product keys to your own customers through the platform.
  - Requested and received a license rotation (proves active use).
- **License revocation on refund**: refunded licenses are added to the revocation list. The next integrity check marks the build as degraded.
- **Disputes**: contact support@nexora.store within 7 days. We respond within 48h.

## What you may NOT do

- Redistribute, resell, or sublicense the source code or any derivative.
- Remove or bypass the license verification system.
- Share your `.license` file publicly or with third parties.
- Use Nexora to facilitate illegal activity (stolen accounts, fraud, money laundering). We reserve the right to revoke licenses used for illegal purposes.

## Liability

Nexora is provided "as is". We are not liable for:
- Loss of funds due to misconfigured wallets (wrong xpub, testnet keys on mainnet, etc.).
- Downtime caused by your hosting provider, DNS, or network.
- Actions taken by your end-customers using your shop.
- Regulatory obligations in your jurisdiction (taxes, KYC, AML).

You are responsible for:
- Securing your VPS, keeping secrets rotated, maintaining backups.
- Complying with local laws regarding digital goods sales and cryptocurrency.
- Your own customers' support and dispute resolution.

## Support scope

| Included | Not included |
|----------|--------------|
| Installation help (Docker, .env, xpub setup) | Custom feature development |
| Bug reports + fixes in supported releases | Theme/UI customization |
| Guidance on backup/restore/update flows | Server administration (nginx, DNS, firewall) |
| License rotation on email change | Integration with third-party services |

## Updates

- Updates are delivered via the built-in updater (Docker image pull + healthcheck rollback) or manual download from the releases repository.
- After your update period expires, the installed version continues to work indefinitely — you simply stop receiving new releases until you renew.
- Breaking changes are documented in CHANGELOG.md with migration instructions.

## Contact

- **Pre-sale questions**: DM on Twitter/Telegram or email hello@nexora.store
- **Customer support**: support@nexora.store (48h response, business days)
- **Security issues**: security@nexora.store (24h acknowledgment)