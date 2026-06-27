# invoices/

One file per paying customer. The matching backend image (built by
`customer-build.yml` with `ARG NEXORA_INVOICE_ID=<id>`) fetches its file
on boot + every 24h and gates paid features on it.

## Naming

`invoices/<invoiceId>.json` where `<invoiceId>` is the same value baked
into the image. Allowed shape: `^[A-Za-z0-9._-]{4,64}$`.

## Producing a file

Always go through `scripts/sign-invoice.ts` in `nexora-paid` — the
backend rejects unsigned payloads.

```bash
bun run scripts/sign-invoice.ts \
  --id=inv_2026_001 \
  --email=customer@example.com \
  --status=active \
  --features=search-suggest,admin-bulk,admin-export,admin-customers-csv \
  --expires=2027-12-31T23:59:59Z \
  --note="paid 2026-06-27 via Stripe"
```

## Revoking

Same script, swap `--status=revoked`, replace the file in this repo,
push. The customer loses paid features within 24h (or on next restart).
Re-issuing later? Same again with `--status=active`.

## Format (signed)

```json
{
  "payload": {
    "invoiceId": "inv_2026_001",
    "email": "customer@example.com",
    "status": "active",
    "issuedAt": "2026-06-27T05:30:00.000Z",
    "productId": "nexora-paid",
    "expiresAt": "2027-12-31T23:59:59Z",
    "features": ["search-suggest", "admin-bulk"],
    "note": ".."
  },
  "signature": "<ed25519 hex>"
}
```

`status` accepted values: `active` | `suspended` | `revoked`. Anything
else is treated as invalid by the backend.