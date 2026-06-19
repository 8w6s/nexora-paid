# Nexora Paid — License Ops Runbook

How to issue, inspect, and revoke `.license` files for paying customers.
Audience: maintainer (you).

## Keys

```
.keys/license-signer.private   ← NEVER commit, NEVER ship
.keys/license-signer.public    ← embedded in build at backend/src/lib/license.ts
```

The public key currently embedded:
```
b20fc9037c686ef41ae162dc95f95a7ce16f7557d5c4884d8f28eed17aec44e3
```

If `.keys/` is empty, generate:
```bash
bun run scripts/gen-keypair.ts
```
Then copy the public key hex from `.keys/license-signer.public` into
`backend/src/lib/license.ts → LICENSE_PUBKEY_HEX` and rebuild.

## Issue a license for a new customer

Lifetime, all features:
```bash
bun run scripts/sign-license.ts \
  --email=customer@example.com \
  --customer=cus_2026_001 \
  --note="lifetime, paid 2026-06-19"
```

Annual subscription, all features:
```bash
bun run scripts/sign-license.ts \
  --email=customer@example.com \
  --customer=cus_2026_001 \
  --ttl=365 \
  --note="annual, renews 2027-06-19"
```

Tier-limited (only some plugins):
```bash
bun run scripts/sign-license.ts \
  --email=customer@example.com \
  --customer=cus_2026_001 \
  --ttl=365 \
  --features=search-suggest,admin-bulk \
  --note="basic tier"
```

The CLI writes `./issued/<sanitized-email>.license`. Send that file to the
customer; they drop it next to their Nexora install as `nexora.license` (or
set `LICENSE_FILE=/abs/path` env).

## Available features (paid plugins)

Check the registry at `backend/src/paid/index.ts`. Current set:
- `search-suggest` — storefront autocomplete
- `admin-bulk` — bulk delete/activate products
- `admin-export` — orders CSV export
- `admin-customers-csv` — customers CSV export

## Inspect a customer's license state

The customer can view it themselves: **Admin → Dashboard → License card**.
Surfaces customerId, expiry, features, and a status pill (Active /
Renew soon / Expired / Invalid).

For maintainer-side inspection of the raw payload:
```bash
cat /path/to/customer.license | jq .payload
```

For programatic verification against the live build:
```bash
LICENSE_FILE=/path/to/customer.license \
  bun -e 'import {verifyLicense} from "./backend/src/lib/license.ts"; \
          console.log(JSON.stringify(await verifyLicense(), null, 2))'
```

## Revoke a leaked license

There is no online revocation list (yet). Two options:

### Option 1 — Soft revoke (preferred)

Issue a new license to the legitimate customer with a fresh `customerId`
and ask them to replace the file. The leaked one keeps "working" for
whoever has it, but only on the version they froze at — they will not
receive any update bundle that requires a renewed license check (see the
update-channel design in the architecture notes).

### Option 2 — Hard revoke (rotate the key pair)

Use only when a key leaks or you want to invalidate ALL licenses at once.

1. Generate a new keypair:
   ```bash
   mv .keys/license-signer.private .keys/license-signer.private.OLD
   mv .keys/license-signer.public  .keys/license-signer.public.OLD
   bun run scripts/gen-keypair.ts
   ```
2. Update `LICENSE_PUBKEY_HEX` in `backend/src/lib/license.ts` to the new
   public key.
3. Re-sign + redistribute licenses to every legitimate customer.
4. Tag a new release; old image versions still verify against the old
   pubkey, so coordinate the rebuild + customer email together.

Hard revoke is a nuclear option. Prefer option 1.

## Watermarking a leaked file

Every `.license` file embeds the buyer's `email` and `customerId` in the
signed payload. If a file surfaces publicly, the payload tells you exactly
who originally received it. Surface this in support conversations to set
expectations: leaks are traceable.

## Common errors and fixes

| Bot banner reason | Cause | Fix |
|---|---|---|
| `no license file at <path>` | File missing or wrong path | Drop `nexora.license` next to the binary or set `LICENSE_FILE=` |
| `wrong productId: ...` | License was signed with `--product=` other than `nexora-paid` | Re-sign with the correct productId |
| `signature mismatch` | License tampered, OR build embeds the wrong pubkey | Verify pubkey matches `.keys/license-signer.public`, re-issue if needed |
| `license expired at <date>` | TTL elapsed | Re-sign with new `--ttl=N` and ship the new file |
| `not in license features` (per plugin) | Plugin not in the license `features[]` allowlist | Re-sign with `--features=` including that plugin id |

## Future work (not yet built)

- **CDN update channel** — `nexora-updates.cdn.com` shipping signed bundles;
  expired license = no updates received. See `docs/UPGRADE_PLAN_V2.md` for the
  intended design.
- **Anti-fraud blocklist intel** — Cloudflare Worker aggregating fraud reports
  from N customers, only delivered to license holders.
- **Telemetry-based leak detection** — opt-in beacon; vendor side flags
  same `customerId` running in >3 ASNs.

These are post-MVP. Until they ship, license enforcement is purely
**static signature verification at boot**, watermarking, and trust.