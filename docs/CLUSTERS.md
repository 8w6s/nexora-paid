# Nexora Paid: Cluster Roadmap

Feature clusters organize the roadmap into coherent release groups. Each cluster = independent feature set that can ship separately.

## Active Clusters

### Cluster A: Search & Discovery ✅

**Status**: Complete (v0.2.0)

**Features**:
- Autocomplete endpoint: `GET /api/products/suggest?q=...`
- Returns 8 lightweight product hits (id, name, slug, price, image)
- No stock join (quick for slow networks)
- Plugin: `search-suggest` (backend/src/paid/search.ts)

**Why separate cluster**: search is a storefront UX multiplier; can ship independently from bulk ops.

### Cluster F: Admin Bulk Operations & Export ✅

**Status**: Complete (v0.2.0)

**Features**:
- Bulk delete orders/products: `POST /api/admin/bulk/delete`
- Bulk activate orders/products: `POST /api/admin/bulk/activate`
- Export orders as CSV: `GET /api/admin/export/orders/csv`
- Export customers as CSV: `GET /api/admin/export/customers/csv`
- Audit logging: every bulk action recorded in `admin_actions` table
- Plugins:
  - `admin-bulk` (backend/src/paid/admin-bulk.ts)
  - `admin-export` (backend/src/paid/admin-export.ts)
  - `admin-customers-csv` (backend/src/paid/admin-customers-csv.ts)

**Why separate cluster**: admin convenience features; decoupled from customer-facing features.

## Planned Clusters

### Cluster C: Multi-Crypto (BTC/ETH) 🔄

**Status**: Scaffolded (feature flags in place, no implementation yet)

**Planned Features**:
- **Bitcoin (BTC)**: UTXO model (similar to LTC)
  - Xpub derivation (P2PKH, P2SH-P2WPKH, P2WPKH)
  - Blockchain watcher: mempool.space API
  - State machine + payment flow (like LTC)

- **Ethereum (ETH)**: Account-based model (different from UTXO)
  - Derivation: m/44'/60'/0'/0/[index] (BIP44 path)
  - Balance check: Etherscan API (need API key)
  - Unit conversion: wei ↔ ETH (18 decimals)
  - State machine: same (pending → paid → completed)

**Scope**:
- Generalize HD wallet logic (handle 3 coin types)
- Per-coin settings (xpub/address, required confirms, explorer key)
- Checkout: customer chooses coin (radio buttons or dropdown)
- Watcher: spawn per-coin loop
- Plugin: `multi-crypto` (when ready)

**Risks**:
- ETH account-based ≠ UTXO logic; careful code review
- Etherscan rate limits; backoff strategy needed
- Wrong derivation path = customer loses fund; extensive testing required

**Timeline**: After Cluster F stabilizes + production testing

### Cluster D-Z: (Future)

Proposed clusters (not yet scoped):
- **Cluster D**: Advanced admin reporting (revenue by product, customer lifetime value)
- **Cluster E**: Affiliate program (share profit with resellers)
- **Cluster G**: Discord/Telegram bot (order notifications, key delivery to chat)
- **Cluster H**: Payment method integrations (Stripe, PayPal — accepts fiat)
- **Cluster I**: Product variants (bundles, subscriptions: 1mo/3mo/12mo)
- etc.

## Why Clusters?

1. **Release Planning**: each cluster = shippable MVP (not half-done features)
2. **Testing**: independent cluster test suite
3. **Deployment**: customers can adopt clusters one at a time
4. **Parallelization**: teams can work on different clusters
5. **Communication**: "Cluster A ships Oct 2026" is clearer than feature lists

## How to Propose a New Cluster

1. **Scope**: define 3–5 coherent features that ship together
2. **Risk**: identify data/security concerns
3. **Dependencies**: does it require Cluster X first?
4. **Plugin**: will this be a paid plugin?
5. **PR**: open `docs/CLUSTERS.md` PR with new section
6. **Approval**: maintainer reviews scope + risk
7. **Implement**: follow PLUGIN_DEV.md conventions

## Version Pinning

- **NEXORA_VERSION**: 0.2.0 (bumped when plugin contract changes)
- **Cluster A/F**: pin `nexoraVersion: ">=0.2 <0.3"`
- **Cluster C** (when ready): will bump to 0.3.0 (new explorer abstraction)
- **New plugins**: use current NEXORA_VERSION range

## Tracking

See `git log --oneline` for cluster commits:
```
e6614e6 feat(paid): SearchBox autocomplete in StorefrontHeader (Cluster A)
b4a48f7 feat(paid): add /api/products/suggest autocomplete endpoint (Cluster A)

1a55d88 feat(paid): bulk-activate endpoint + refactor shared bulk helper
6c2fb55 feat(paid): CSV export of orders (Cluster F)
```

---

**Questions?** See PLUGIN_DEV.md for plugin architecture, or LICENSE_ROTATION.md for licensing questions.