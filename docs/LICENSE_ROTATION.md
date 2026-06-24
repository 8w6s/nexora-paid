# License Rotation & Incident Response

How to rotate licensing keys and respond to security incidents.

## License System Overview

- **One-time pay**: customers buy once, run forever (no subscription)
- **Offline verify**: ed25519 signature, no network call
- **Watermark**: buyer email embedded in license file → leak traceable
- **Key location**: `./nexora.license` (or `LICENSE_FILE` env var)

## When to Rotate Keys

### Scenario 1: Private Key Leaked

**Risk**: anyone with private key can forge licenses (all future licensing breaks)

**Steps**:
1. Stop issuing licenses immediately
2. Generate new keypair (see below)
3. Update `LICENSE_PUBKEY_HEX` in code + rebuild
4. Notify all customers: "Please upgrade to new version (new license required)"
5. Old licenses: grace period 30 days (keep old public key in code temporarily?)
   - **Decision**: support old key during transition (complexity) or force upgrade (user pain)
   - **Recommended**: 30-day grace, then require upgrade

### Scenario 2: Expiry Policy (future)

If licenses expire:
- Bump `NEXORA_VERSION` from 0.2 → 0.3 (e.g.)
- Old licenses with `expiresAt < now()` → rejected
- Customers re-buy / upgrade to renew

(Currently: no expiry; licenses are lifetime)

### Scenario 3: Version Bump

When Nexora v0.3 ships with breaking plugin changes:
- Existing plugins may no longer load (compat range)
- Customers must rebuild with new plugin versions OR downgrade plugins
- **Usually**: no key rotation needed (code change only)

## How to Rotate Keys

### Step 1: Generate New Keypair

```bash
cd nexora
bun scripts/gen-keypair.ts
```

**Output**:
- Prints public + private key (hex)
- Writes private key to `.keys/license-signer.private` (gitignored)
- Writes public key to `.keys/license-signer.public` (safe to share)

### Step 2: Update Public Key in Code

Edit `backend/src/lib/license.ts`:

```typescript
const LICENSE_PUBKEY_HEX = "<NEW-PUBLIC-KEY-HEX>";
```

Replace the old 64-character hex string.

### Step 3: Rebuild & Deploy

```bash
# Rebuild Docker image with new public key
docker build -t nexora:v0.2.1-rotated .

# Or: rebuild standalone binary
bun build --compile src/index.ts
```

### Step 4: Issue New Licenses

Use **new private key** to sign:

```bash
bun scripts/sign-license.ts 
  --email customer@example.com 
  --productId nexora-paid 
  --output customer-license.json
```

## Customer Communication Template

**Subject**: Nexora License Upgrade (One-Time, Immediate)

```
Hi [Customer],

We've rotated our licensing keys for security (private key rotation incident).
Your existing license will stop working on [DATE].

To continue:
1. Download new license: [LINK]
2. Replace ./nexora.license in your Nexora folder
3. Restart server

No charge; this is a one-time update.
Questions? Email support@nexora.local

Thanks,
Nexora Team
```

## Grace Period Strategy

### Option A: Hard Stop (No Grace)

**Pros**: simple, secure
**Cons**: customers without notification lose access immediately

```typescript
if (!lic.valid) {
  console.warn(`License invalid; all plugins disabled`);
  // Fall back to Free
}
```

### Option B: Grace Period (30 Days)

**Pros**: time for customers to update
**Cons**: temporarily two keys in production (complexity)

```typescript
const gracePeriodUntil = new Date("2026-07-01");
if (!licNew.valid && !licOld.valid && now > gracePeriodUntil) {
  // Both old + new keys invalid, past grace → hard stop
  console.warn("Grace period expired; license required");
}
```

**Recommended**: Option B (notified customers, 30-day grace, then hard stop)

## Security Incident Response Checklist

- [ ] **Contain**: stop issuing old licenses immediately
- [ ] **Assess**: how many customers affected? (count existing licenses)
- [ ] **Generate**: new keypair
- [ ] **Update**: `LICENSE_PUBKEY_HEX` in code
- [ ] **Build**: new Docker image / binary
- [ ] **Test**: verify new licenses verify correctly
- [ ] **Notify**: send email to all customers with upgrade link
- [ ] **Deploy**: push new version to production
- [ ] **Monitor**: watch for license validation errors
- [ ] **Archive**: old private key → secure cold storage (or destroy)

## Key Storage Best Practices

### Private Key (.keys/license-signer.private)

- ✅ **Gitignored**: never committed to repo
- ✅ **Encrypted**: store in HSM or encrypted vault (production)
- ✅ **Access**: only maintainer has copy
- ✅ **Backup**: secure backup (separate from main repo)
- ✅ **Rotation**: on incident, generate new pair + destroy old

### Public Key

- ✅ **In code**: `LICENSE_PUBKEY_HEX` is public (shipping in binary)
- ✅ **Shareable**: `.keys/license-signer.public` can be published
- ✅ **Verification**: customers can verify license manually if needed

## Troubleshooting

### "License invalid (no public key embedded in build)"

**Cause**: `LICENSE_PUBKEY_HEX` still has placeholder (all zeros)

**Fix**:
```typescript
// In backend/src/lib/license.ts, check:
if (LICENSE_PUBKEY_HEX === "00".repeat(32)) {
  // Placeholder still in code
}
// Replace with real public key, rebuild
```

### "License invalid (signature mismatch)"

**Cause**: license was signed with old key, but code has new key

**Fix**:
- Verify license was signed with current key
- Re-sign with `bun scripts/sign-license.ts`
- Or: temporarily revert to old key for transition period

### Customer Loses Access After Upgrade

**Cause**: old license doesn't verify against new public key

**Recovery**:
1. Issue new license
2. Send to customer
3. Customer replaces `.license` file
4. Restart

---

**See also**:
- CLUSTERS.md: roadmap planning
- PLUGIN_DEV.md: plugin compatibility versioning