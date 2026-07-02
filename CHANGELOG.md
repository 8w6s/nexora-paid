# Changelog

All notable changes to Nexora Paid are documented here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and the project
adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [1.1.0] — 2026-07-02

First public v1.1 release. Aggregates 23 rc iterations of hardening,
UX polish, and infrastructure work on top of v1.0.0. Every rc is
tagged individually — v1.0.0-rc1 through v1.0.0-rc23 — for anyone
who wants to bisect an issue to the exact iteration that introduced
it. This section summarises the delta from v1.0.0.

### Security — pre-sale hardening pass

- **HTML sanitizer on the write path.** Product + category descriptions
  pass through a regex-based allowlist before insert/update. Strips
  `<script>`, `<iframe>`, `<svg>`, `<object>`, `on*` handlers, and
  `javascript:` URLs; forces `rel="noopener noreferrer nofollow"` on
  external `target=_blank` links. 17 unit tests cover the payload matrix.
- **License `expiresAt` is now enforced.** `verifyLicense` returns
  `license expired at <ISO>` when `Date.now()` is past the timestamp;
  unlocks annual / trial / support-window pricing.
- **`DATABASE_ENCRYPTION_KEY` requires 64 hex chars in production.** The
  sha256-of-passphrase fallback is rejected when `NODE_ENV=production`
  with a clear error pointing at `openssl rand -hex 32`.
- **Raw SQL console gated behind `NEXORA_ENABLE_RAW_SQL=true`.** Default
  is off — the Native CRUD editor (whitelisted tables, parameterized
  writes) is the supported path. Drastically shrinks the blast radius of
  a stolen admin cookie.
- **Integrity-degraded gate covers every admin plugin route.** New
  `degradedGate` helper in `lib/integrity-state.ts` is wired into
  `admin-db`, `admin-tables`, `admin-update`, `admin-blocklist`,
  `admin-2fa` — previously only the main `adminRoutes` mount blocked
  mutations on a tampered build.
- **`NEXORA_LICENSE_SECRET` required in production for snapshot key.**
  Falling back to the in-volume `license.lic` let a volume-copy attack
  derive the AES key for every encrypted snapshot. Production now
  refuses to derive without an out-of-band secret (env / KMS / secret
  manager).

### Fixed — payment correctness

- **Last-chance poll before expiring stale orders.** `expireStaleOrders`
  re-polls every payable order one more time before flipping it to
  `expired`. A customer who paid within the recheck cooldown (default
  90 s) or seconds before the deadline no longer silently loses their
  order — the late confirmation flows through `markPaidAndDeliver` +
  delivery hooks normally. Re-reads PAYABLE after the poll wave so only
  truly unpaid rows are expired.

### Changed — deployment ergonomics

- **Compose backend pulls production secrets from `.env`.** New
  `env_file: .env` (required=false) plus explicit `environment:` keys
  for `ORDER_TOKEN_SECRET`, `DATABASE_ENCRYPTION_KEY`,
  `NEXORA_LICENSE_SECRET`, `NEXORA_UPDATER_PSK`,
  `NEXORA_ENABLE_RAW_SQL`. Buyers drop their generated secrets in `.env`
  once and the stack picks them up — no compose surgery.
- **Updater overlay carries PSK + GHCR token + image pins.** The
  `updater` service in `docker-compose.updater.yml` now receives
  `NEXORA_UPDATER_PSK`, `GHCR_TOKEN`, `NEXORA_IMAGE*`, `NEXORA_VERSION`,
  plus a socket-stat healthcheck so the in-place update flow has every
  knob it needs without inline edits.
- **Cloudflare-Tunnel mode gets its own `Caddyfile.tunnel`.** `auto_https
  off` + bare `:80` listener avoids the redirect loop with CF
  terminating TLS upstream. Switch via `CADDYFILE=./Caddyfile.tunnel`
  env in `.env` — no rebuild.
- **`.env.example` lists every required production secret** with
  `openssl rand -hex 32` commands inline + the updater PSK + GHCR PAT +
  the Caddyfile switch documented next to the tunnel runbook.
- **`docs/MIGRATION_POSTGRES.md` flagged experimental / developer-only.**
  Supported plans stay on SQLite — the Postgres path requires a fork
  (no `DATABASE_URL` runtime switch, no compose profile, no automated
  rollback) and is not exercised by the release smoke.
- **Release checklist covers coupon checkout.** New smoke step asserts
  `discountUsd > 0`, locked LTC reflects the discounted USD total, and
  `coupons.usedCount` increments exactly once under concurrent
  checkouts; bad codes return `BAD_COUPON` 400.

### Added — security / infrastructure

- **Updater handshake (PSK + HMAC + nonce).** Every backend → updater call
  over the unix socket now carries a timestamped, nonce-tagged HMAC computed
  with `NEXORA_UPDATER_PSK`. Defends against a rogue process on the host
  that managed to bind-mount the socket. 30s skew tolerance, 4096-entry
  LRU nonce cache for replay defense.
- **Image digest pinning + post-healthcheck cleanup.** The updater verifies
  the local image's `RepoDigest` against the manifest's `sha256` before
  considering a pull successful, defeating GHCR tag-swap attacks. The
  previous image is reclaimed only after the new one passes healthcheck.
- **Encrypted snapshots (NXS1 format).** Snapshots produced by the updater
  are now AES-256-GCM with a key derived from
  HKDF-SHA256(license-secret ‖ machine-id). Moving the snapshot to a
  different host invalidates it.
- **Tenant isolation library.** Android-style data jail —
  `/data/app/` (DB, secrets, license) is reachable only by admin APIs;
  `/data/userspace/` (uploads, assets) is the customer-admin facing tree.
  Every path coming from a request passes through `jailUserspace()` /
  `jailApp()` which reject null bytes, parent traversal, and absolute paths.

### Added — admin surface

- **DB Editor (full SQL + audit log pane).** Power-user SQL console for
  admins. Every mutation is recorded in the new `audit_log` table with the
  actor's email, IP, statement, row count, and elapsed time. Refuses
  `ATTACH/DETACH`, `load_extension()`, writable PRAGMA, and any write that
  targets `audit_log` itself. 5000-row result cap, 64 KB statement cap,
  30 queries/min/IP rate limit.
- **Native CRUD route.** `GET/POST/PATCH/DELETE /api/admin/tables/:name/rows`
  drives the upcoming no-SQL Native Editor. Table names whitelisted against
  `sqlite_master`, column names against `PRAGMA table_info`, all values
  bound (no interpolation). 60 writes/min/IP.
- **Unified `audit_log` mirror.** `logAdminAction()` now writes to BOTH the
  legacy `adminActions` table (Activity Log UI) AND `audit_log` (DB Editor
  audit pane), with optional `meta = { ip, target, success }`. Mirror is
  best-effort; a failure in one store never blocks the other or the action.
- **Blocklist rate-limit.** Add/remove on `/api/admin/{blacklist,whitelist}`
  capped at 60 writes/min/IP shared across both modes.

### Added — update orchestration

- **`GET /api/health/deep`.** Readiness probe (no auth) returning version,
  schema number, DB ping latency, uptime, and updater-socket availability.
  Safe for external monitoring — no env vars, no paths, no secrets surfaced.
- **`POST /api/admin/update/warm-pull`.** Pre-stage the next image while
  the old version is still serving traffic. The eventual `/apply` then
  skips the slow `docker pull` and the only customer-visible downtime is
  the swap-restart.

### Added — libraries

- **`lib/catbox.ts`.** Transport-layer uploader for the upcoming
  "Share to catbox" admin action. 50 MB cap, filename sanitization
  (basename only, control chars stripped), 60s timeout, anonymous by
  default, optional `CATBOX_USERHASH` env for deletion-capable auth.
  10 unit tests with a fetch interceptor — no live network in CI.

### Changed

- Boot path now refuses to start in production when `PUBLIC_ORIGIN` is unset
  or non-HTTPS, or when `ORDER_TOKEN_SECRET` is shorter than 32 chars.
- Inline `/api/health` handler replaced with `healthRoutes` plugin
  (no behavior change at the `/api/health` URL — backward compatible).

### Fixed

- Several biome lint nits across audit-window files (useImportType,
  useOptionalChain, noConsole). No semantic change.

### Test coverage

- 88 lib tests (was 26 at start of v1.1 work).
- handshake: 12 cases (round-trip, replay, skew bi-directional,
  1 MB body, malformed ts, distinct nonces, body-binding).
- snapshot-crypto: 13 cases (round-trip, wrong-key, tamper at every
  byte offset, empty / 1 MB payloads, NXS1 magic guard).
- tenant jail: 18 cases (traversal, null bytes, slash normalization,
  dotted segments, app vs userspace separation).
- catbox: 10 cases (URL parsing, sanitization, oversize early refusal,
  HTTP error / non-URL response, userhash env forwarding).

## [1.0.0] — 2026-06-25

Initial public release. See
<https://github.com/8w6s/nexora-paid/releases/tag/v1.0.0> for the full
v1.0.0 announcement; this changelog tracks v1.1.0+ deltas.