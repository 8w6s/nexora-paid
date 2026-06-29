# Nexora Paid — Tài liệu dự án chi tiết

> Tài liệu tổng quan đầy đủ về dự án `nexora-paid`. Mọi đường dẫn được nêu là tương đối với gốc repo `C:/Users/FUJITSU/Desktop/PROJECTS/nexora-paid` trừ khi nói rõ khác.

---

## 1. Tóm tắt sản phẩm

**Nexora** là một self-hosted digital-goods storefront (cửa hàng bán sản phẩm số) lấy SellAuth làm tham chiếu UX. Khách hàng mua một bản license và tự host stack qua Docker. Nhân hệ thống là một backend Bun + Elysia + SQLite, một storefront Astro 5 SSR (React 19 islands), một updater chạy như sidecar, và một fileserver công cộng dùng để phân phối manifest cập nhật + kiểm tra revoke license.

Đặc trưng quan trọng:

- **Thanh toán Litecoin on-chain qua HD wallet** — không phụ thuộc bên thứ ba; mỗi order có địa chỉ con BIP32 riêng, watcher poll BlockCypher + litecoinspace.org để xác nhận.
- **License Ed25519 offline** — gắn email người mua, có thể bị thu hồi qua revoked.json.
- **Integrity manifest** — toàn bộ file backend được hash + ký ed25519 lúc build; boot fail-loud nếu bị sửa.
- **Plugin v2 gated bằng license + integrity + invoice gate** — tính năng cao cấp (`search-suggest`, `admin-bulk`, `admin-export`, `admin-customers-csv`) chỉ load khi cả ba lớp gate đều pass.
- **Per-customer build** — mỗi invoice được nướng vào một docker image riêng với `NEXORA_INVOICE_ID` + `NEXORA_INVOICE_EMAIL` để truy vết.
- **One-command installer** — `curl … | bash` để khách hàng cài đặt với rolling tag `latest-<invoice>`.

Version hiện tại: **1.0.0** (released 2026-06-25). **1.1.0** đang trong giai đoạn unreleased với hardening sâu.

---

## 2. Cấu trúc thư mục cấp cao nhất

```
nexora-paid/
├── backend/                  Bun + Elysia API server
├── frontend/                 Astro 5 SSR + React 19 islands storefront
├── updater/                  In-place update microservice (unix socket)
├── fileserver/               Public version manifest + license revoke server
├── docs/                     Tài liệu vận hành cho operator
├── scripts/                  Dev/ops/signing/fulfillment scripts
├── releases/                 ZIP per-customer được sinh ra (output)
├── releases-template/        Template clone vào private nexora-releases repo
├── issued/                   .license files đã ký được phát hành
├── gstack/                   AI dev toolkit (nested git, không phải app Nexora)
├── mimocode-src/             Mimocode IDE source (nested git, không phải app Nexora)
├── pixel-agents/             Pixel Agents VS Code extension (nested git)
├── ss/                       Reference screenshots (SellAuth, nexora admin)
├── .keys/                    Khóa bí mật (gitignored)
├── .github/workflows/        CI/CD (release, fulfill, customer-build)
├── .claude/ .gstack/ .loop/ .mimocode/ .dev-logs/ .dual-graph/   AI dev state
├── package.json              Bun workspaces root
├── biome.json                Biome lint + format
├── bun.lock                  Lockfile
├── tsconfig.json             Root TS path config
├── docker-compose.yml        Production stack chính
├── docker-compose.updater.yml  Overlay thêm updater
├── Caddyfile                 Auto-HTTPS (Let's Encrypt)
├── Caddyfile.tunnel          Cloudflare Tunnel variant
├── CLAUDE.md                 Claude Code session policy
├── CONTEXT.md                Session resume notes (AI-maintained)
├── CHANGELOG.md              Semver changelog
├── README.md                Operator README
├── TERMS.md                  Customer terms
├── SELLAUTH_REFERENCE.md     SellAuth parity reference
├── NOTES.md                  Developer notes
├── .env / .env.example       Root env (shared bởi compose)
├── add-i18n.js               One-off script chèn key i18n
└── nexora.license            Dev/test license đặt ở root
```

---

## 3. Tech stack

### Runtime + package manager
- **Bun 1.x** vừa là runtime vừa là package manager. `bun.lock` (binary lockfile). `bunfig.toml` (config tối thiểu).

### Ngôn ngữ
- **TypeScript** (chủ đạo) — backend, frontend, scripts, updater, fileserver
- **JavaScript (CJS)** — `add-i18n.js`, `add-pd-i18n.cjs`, `add-session-confirm-keys.cjs`
- **Python** — `scripts/i18n-diff.py`
- **Bash** — operational scripts
- **SQL** — migration files

### Backend dependencies (`backend/package.json`)
| Mục | Package |
|---|---|
| HTTP framework | `elysia@^1.2.0` + `@elysiajs/cors@^1.2.0` |
| ORM | `drizzle-orm@^0.30.10` |
| DB driver | Bun native SQLite (qua `drizzle-orm/bun-sqlite`) |
| Migrations dev | `drizzle-kit@^0.21.4` |
| HD wallet (BIP32) | `@scure/bip32@^2.2.0` |
| Base58/bech32 | `@scure/base@^2.2.0` |
| Ed25519 | `@noble/ed25519@^3.1.0` |
| Hashing | `@noble/hashes@^2.2.0` |
| Validation | `valibot@^1.4.1` |
| Semver | `semver@^7.8.2` |
| Concurrency | `p-limit@^7.3.0` |
| Postgres (optional) | `postgres@^3.4.9` |
| TS compiler | `typescript@^6.0.3` |

### Frontend dependencies (`frontend/package.json`)
| Mục | Package |
|---|---|
| SSR framework | `astro@^6.4.2` |
| SSR adapter | `@astrojs/node@^10.1.3` |
| UI islands | `react@^19.0.0` + `react-dom@^19.0.0` |
| React integration | `@astrojs/react@^4.2.0` |
| SEO | `@astrojs/sitemap@^3.7.3` |
| Global state | `nanostores@^1.3.0` + `@nanostores/react@^1.1.0` |
| Animation | `animejs@^3.2.2` |
| Smooth scroll | `lenis@^1.3.23` |
| Loading spinner | `ldrs@^1.1.9` |
| Validation | `valibot@^1.4.1` |

### Dev tooling (root)
| Mục | Package |
|---|---|
| Lint/format | `@biomejs/biome@^2.5.0` (thay ESLint + Prettier) |
| Terminal UI | `@opentui/core@^0.4.1` + `@opentui/solid@^0.4.1` |
| CLI rendering | `ink@^7.0.6` |
| Process runner | `concurrently@^10.0.3` |
| Crypto (signing scripts) | `@noble/ed25519@^3.1.0`, `@noble/hashes@^2.2.0` |

### Build tools
- `bun build --compile` — sản xuất single binary (`nexora.js`) cho backend
- `astro build` — sản xuất Astro SSR node bundle ở `frontend/dist/server/`
- Docker multi-stage build — image kết hợp ship cả hai bundle
- Biome — lint + format

---

## 4. Entry points

### Backend
**`backend/src/main.ts`** — Compile-time entry (cho `bun build --compile`). Gọi `await import("./index.ts")` trong async wrapper để tránh top-level await trong binary entry.

**`backend/src/index.ts`** — Runtime entry. Trình tự boot:
1. **Production guard**: refuse boot nếu `NODE_ENV=production` và (`PUBLIC_ORIGIN` thiếu/non-HTTPS, `ORDER_TOKEN_SECRET < 32 ký tự`, hoặc `TRUST_PROXY != true`) → `process.exit(1)`.
2. Tạo base Elysia app với CORS, request logging, error handler, CSRF middleware, security headers.
3. `initIntegrity()` — verify ed25519 manifest.
4. `initInvoiceGate()` nếu `NEXORA_INVOICE_ID` đã được nướng vào image.
5. `loadPlugins(baseApp)` — license-gated + integrity-gated paid plugin loader.
6. Mount tất cả route plugin (19 route module).
7. `bootstrapAdmin()`, `primeOrderTokenSecret()`, `registerNotifications()`, `recoverStuckOrders()`, `startWatcher()`.
8. Listen `PORT` (default 3000).
9. In boot banner.

Dev: `bun --watch src/index.ts` (qua `bun run dev:backend`).

### Frontend
**`frontend/astro.config.mjs`** — `output: "server"`, `@astrojs/node` standalone adapter, React integration, sitemap. Dev proxy `/api` → `http://localhost:3000`.

Sau build, Astro entry là `frontend/dist/server/entry.mjs`.

### Combined Docker entry
**`backend/Dockerfile`** `CMD ["/app/start.sh"]` — Shell supervisor spawn cả backend (`bun run nexora.js`) và frontend (`bun run dist/server/entry.mjs`) song song; exit nếu một trong hai chết.

### Dev TUI
**`scripts/tui.tsx`** (entry cho `bun run dev`) — Render ASCII banner + spinner, sau đó launch OpenTUI ở `scripts/tui/index.tsx`. TUI quản lý spawn + monitor cả backend và frontend, stream log realtime.

---

## 5. Database / data layer

**Driver:** Bun native SQLite (WAL mode). **ORM:** Drizzle.
**Schema:** `backend/src/db/schema.ts`. **Config:** `backend/drizzle.config.ts` (dialect `sqlite`, đọc `DB_PATH`).

### Bảng

| Bảng | Mục đích | Cột chính |
|---|---|---|
| `users` | Customer + admin | `id`, `email`, `passwordHash`, `role`, `status`, `totpSecret` (encrypted), `totpEnabled`, `lastTotpCounter`, `totpBackupCodes`, `locale` |
| `sessions` | Auth sessions | `token`, `userId`, `expiresAt`, `lastSeenAt`, `ipAddress`, `userAgent`, `lastIp` |
| `coupons` | Discount codes | `code`, `type`, `value`, `maxUses`, `usedCount`, `minOrderUsd`, `active`, `expiresAt` |
| `categories` | Phân loại sản phẩm | `id`, `parentId`, `name`, `slug`, `description`, `image`, `sortOrder` |
| `products` | Sản phẩm | `id`, `slug`, `name`, `description`, `priceUsd`, `image`, `category`, `categoryId`, `compareAtPrice`, `deliverables` (serials/service/dynamic), `active`, `sold` |
| `product_variants` | Variant/SKU | `id`, `productId`, `name`, `priceUsd`, `compareAtPrice` |
| `product_keys` | Inventory key số | `id`, `productId`, `variantId`, `code` (AES-encrypted), `status`, `keyType` (code/account/file/instructions), `orderId` |
| `orders` | Order | `id`, `userId`, `email`, `status` (7 trạng thái), `totalUsd`, `ltcRate`, `rateSource`, `ltcAmount`, `expectedLitoshi`, `addressIndex`, `ltcAddress`, `receivedLitoshi`, `confirmations`, `paidTxId`, `paidAt`, `deliveredAt`, `expiresAt`, `lastCheckedAt` |
| `order_items` | Line item | `orderId`, `productId`, `name`, `priceUsd`, `quantity` |
| `settings` | Key-value | `key`, `value` (AES-encrypted), `updatedAt` |
| `reviews` | Đánh giá sản phẩm | `productId`, `userId`, `email`, `rating`, `body`, `hiden` |
| `tickets` | Support ticket | (theo route tickets) |
| `admin_actions` | Audit log legacy | Dữ liệu cho Activity log UI |
| `audit_log` | SQL console audit | `actor email`, `IP`, `statement`, `row count`, `elapsed time` |
| `blocklist/whitelist` | IP/email block | (migration 0008) |
| `password_resets` | Reset tokens | (migration 0009) |

### Migrations (13 file, `backend/src/db/migrations/`)

| File | Nội dung |
|---|
| `0000_init.sql` | Khởi tạo schema (users, sessions, coupons, categories, products, orders, order_items, settings, reviews, tickets) |
| `0001_variants.sql` | `product_variants` + `variantId` trên `product_keys` |
| `0002_totp.sql` | Cột TOTP cho users |
| `0003_totp_hardening.sql` | `lastTotpCounter`, `totpBackupCodes` |
| `0004_orders_perf_indexes.sql` | Index perf trên orders |
| `0005_session_last_seen.sql` | `lastSeenAt` cho sessions |
| `0006_orders_last_checked.sql` | `lastCheckedAt` cho orders (watcher prioritization) |
| `0007_session_metadata.sql` | `ipAddress`, `userAgent`, `lastIp` cho sessions |
| `0008_blocklist.sql` | Bảng blocklist/whitelist |
| `0009_password_resets.sql` | Reset password tokens |
| `0010_user_locale.sql` | Cột `locale` cho users |
| `0011_audit_log.sql` | Bảng `audit_log` cho SQL console |
| `0012_backfill_categories.sql` | Backfill products cũ vào categories |

### Field-level encryption
Custom Drizzle type `encryptedText` ở `schema.ts`. Write: `encrypt(value)` (AES-256-GCM, key `DATABASE_ENCRYPTION_KEY`). Read: `decrypt(value)`.
Field encrypted: `totp_secret` (users), `code` (product_keys), `value` (settings).

---

## 6. Authentication

`backend/src/lib/auth.ts` + `backend/src/routes/auth.ts` + `backend/src/routes/customer-2fa.ts`.

- **Session cookie**: `httpOnly`, `sameSite=strict`, `secure` trong production.
- **Password hash**: argon2id (Bun native `Bun.password.hash`).
- **Admin bootstrap**: `bootstrapAdmin()` — tạo admin từ `ADMIN_EMAIL` + `ADMIN_PASSWORD`/`ADMIN_PASSWORD_HASH` env ở lần boot đầu.
- **TOTP 2FA**: RFC-6238, secret encrypted, `lastTotpCounter` chống replay, scrypt backup codes. Verify code trước khi bind secret (security fix `f-11`). Yêu cầu re-auth trước khi tắt admin 2FA (`f-13`).
- **Rate limiting**: In-memory sliding-window (`backend/src/lib/rate-limit.ts`). Per-IP. Chỉ honor `X-Forwarded-For` khi `TRUST_PROXY=true`. Lockout per-account khi sai liên tục.
- **CSRF**: Validate `Origin`/`Referer` trên mọi state-changing request so với `PUBLIC_ORIGIN`. Thiếu cả hai → 403.
- **Order tokens**: HMAC-signed guest token để truy cập order SSE + detail mà không cần session.
- **Customer 2FA**: Flow TOTP riêng cho customer.

---

## 7. Payment system — Litecoin on-chain

### HD wallet
- `backend/src/lib/hd.ts` — `@scure/bip32` + `@scure/base`. Accept `Ltub` / `Mtub` / `zpub` xpub.
- Mỗi order derive child tại `m/0/[addressIndex]` (index lưu ở `orders.addressIndex`).
- `validateXpub` reject single address `ltc1q…` với code `BAD_XPUB`.

### Exchange rate
Fetch USD/LTC từ **Kraken** (primary), fallback **Coinbase**. Rate lock tại order creation (`orders.ltcRate`).

### Watcher (`backend/src/lib/watcher.ts`)
- Poll **BlockCypher** (primary, kèm `BLOCKCYPHER_TOKEN`) và **litecoinspace.org** (fallback) cho từng address của order payable.
- Sắp xếp ưu tiên oldest-checked qua index `lastCheckedAt`.
- `checkOrder` group theo `dk.productId` để emit hook `product.delivered` đúng.
- `redeliverPaid` group theo productId ở recovery path.

### Payment decision (`backend/src/lib/payments.ts`)
- `paymentDecision()` so sánh cumulative `receivedLitoshi` với `expectedLitoshi`. Hỗ trợ underpayment + top-up.
- `PAYABLE` bao gồm cả `underpaid` để cho phép top-up sau.
- Cần N confirmations (default 2).

### Delivery (`backend/src/lib/inventory.ts`)
- `markPaidAndDeliver()` atomically đánh dấu key delivered, update order → `paid` → `completed`.
- Idempotent (survive restart). Emit `product.delivered` hook với `{productId, name, code}[]`.

### Order expiry
- `expireStaleOrders()` re-poll lần cuối trước khi expire stale orders.
- WARN log khi expire underpaid order có `receivedLitoshi > 0` (operator scan log để refund off-chain).

### SSE
- Realtime status qua `GET /api/orders/:id/events`. Per-key SSE concurrency cap `DELIVER_HOOKS_MAX=5`. Auth qua session hoặc order token.

---

## 8. License system

Vị trí: `backend/src/lib/license.ts`, `scripts/sign-license.ts`, `scripts/gen-keypair.ts`.

- **Algorithm**: Ed25519 (`@noble/ed25519`).
- **Public key embedded**: `b20fc9037c686ef41ae162dc95f95a7ce16f7557d5c4884d8f28eed17aec44e3` (trong `integrity.ts` là `BUILD_PUBKEY_HEX`).
- **Format file**: JSON `{ payload, signature }`. Payload: `{ productId, customerId, email, issuedAt, expiresAt?, features[], note? }`.
- **Đường dẫn**: `./nexora.license` hoặc `LICENSE_FILE` env. Đọc ở boot.
- **Verify**: Offline (không cần network). `expiresAt` enforced ở v1.1+.
- **Feature gating**: `features[]` quyết định plugin nào load. Hiện có: `search-suggest`, `admin-bulk`, `admin-export`, `admin-customers-csv`.
- **Watermarking**: Email buyer được nhúng → leak truy ngược được.
- **Revocation**: `fileserver /v1/license` check `revoked.json` từ public releases repo.

---

## 9. Integrity manifest

`backend/src/lib/integrity.ts` + `scripts/build-manifest.ts` + `scripts/verify-manifest.ts`.

- Lúc build, `build-manifest.ts` đi qua `backend/src/**`, hash SHA-256 mỗi file, sản xuất `manifest.signed.json` (Ed25519 signed bằng license key).
- Lúc boot (`initIntegrity()`), verifier đọc manifest, verify signature, re-hash từng file và so sánh.
- Kết quả: `ok=true` (thường), `manifest_not_found` (dev, tolerated), `files_mismatch` (tampered), `signature_invalid` (forged).
- Khi `files_mismatch` hoặc `signature_invalid` → **degraded mode**: admin mutation trả 503, paid plugin skip load, boot banner đỏ.
- `NEXORA_DEV_SKIP_INTEGRITY=true` bị refuse trong production (security fix `f-integrity-1`).

Test: `backend/src/lib/integrity.test.ts` (13 test, 27 expect). Smoke 3-pha qua `scripts/test-integrity.ts`.

---

## 10. Plugin system v2

`backend/src/lib/plugin/loader.ts`, `backend/src/lib/plugin/types.ts`, `backend/src/paid/index.ts`.

Interface: `{ manifest: PluginManifest, register?(app): Elysia, hooks?, migrations?() }`.

`loadPlugins()` check theo thứ tự:
1. License valid (signature + chưa hết hạn + chưa revoke)
2. Integrity không degraded
3. Invoice gate pass (xem mục 13)
4. Per-plugin semver compat với `NEXORA_VERSION`
5. Plugin không bị set `disabled` flag

Plugin paid hiện hoạt động:
- `searchPlugin` — autocomplete search
- `adminBulkPlugin` — admin bulk actions
- `adminExportPlugin` — admin export
- `adminCustomersCsvPlugin` — admin customers CSV

Test: `backend/src/lib/plugin/{compat,hook-bus,migrations}.test.ts`.

---

## 11. Frontend chi tiết

### Routes (`frontend/src/pages/`)

| Route | File | Mục đích |
|---|---|---|
| `/` | `index.astro` | Storefront homepage (product grid, search) |
| `/product/[slug]` | `product/[slug].astro` | Product detail |
| `/checkout` | `checkout.astro` | LTC checkout |
| `/orders` | `orders/index.astro` | My orders |
| `/orders/[id]` | `orders/[id].astro` | Order detail + key delivery |
| `/account` | `account.astro` | Account settings (password, email, 2FA, sessions) |
| `/login` | `login.astro` | Login |
| `/register` | `register.astro` | Register |
| `/forgot` | `forgot.astro` | Forgot password |
| `/reset` | `reset.astro` | Reset password |
| `/tickets` | `tickets.astro` | Support tickets |
| `/admin/[...tab]` | `admin/[...tab].astro` | Admin SPA catch-all |
| `/setup` | `setup.astro` | First-run wizard |
| `/setup-demo` | `setup-demo.astro` | Demo seed setup |
| `/terms` `/privacy` `/refund` | … | Legal pages |
| `/__dev` | `__dev.astro` | Dev SSE log viewer |
| `/404` | `404.astro` | Not found |

### Admin layout
SellAuth-style left sidebar, 5 nhóm (Catalog/Sales/Support/Storefront/System), tổng 12 tab. Top-tab cũ đã bỏ.

### Global UI primitives (bắt buộc reuse)
`Modal`, `Toast` (+ `useToast`), `Dropdown`, `Checkbox`, `ToggleSwitch`, `NumberInput`, `EmptyState`, `SiteFooter`, `ThemeSwitch`, `StorefrontHeader`. Component mới phải tái sử dụng các primitive này, không tự custom.

### Theme system
- Light/dark switch CSS vars + `[data-theme="dark"]`.
- Toggle là Uiverse sun/moon switch ở Navbar + admin sidebar.
- Transition là **wave reveal** (sheet roll-in + sandstorm band ở leading edge). View Transitions API path tồn tại nhưng wave-reveal đang là default.

### Frontend lib (`frontend/src/lib/`)
- `api.ts` — typed fetch wrapper
- `stores.ts` — nanostores atom global state
- `motion.ts` — animation helper
- `themeTransition.ts` — curtain/wave transition

### Middleware (`frontend/src/middleware.ts`)
- Setup guard: nếu chưa có admin, redirect mọi trang về `/setup`.
- Security headers mọi response: `X-Frame-Options: DENY`, `X-Content-Type-Options: nosniff`, `Referrer-Policy`, `Permissions-Policy` (security fix `f-frontend-1`).

---

## 12. i18n

- **5 locale**: en, vi, zh, es, de.
- Frontend: `frontend/src/i18n/locales/<lang>.json` + `LocaleProvider.tsx` + `useTranslation()` hook + `parity.test.ts`.
- Backend: `backend/src/lib/locales/<lang>.json` + `backend/src/lib/i18n.ts` (cho email template, payment instruction…).
- `add-i18n.js` (root) — batch inject key mới qua cả 5 locale.
- `scripts/i18n-diff.py` — tìm gap parity giữa locale.
- `scripts/sync-i18n-to-backend.sh` — sync FE → BE locale.

---

## 13. Customer/invoice flow (privacy + per-customer build)

### `customers.txt` encryption
- Single source of truth (cả trong `releases-template/` và public `nexora-releases` repo).
- Format mới: mỗi entry là `nx1:<base64(iv|tag|ciphertext)>` — AES-256-GCM, key `NEXORA_CUSTOMERS_KEY` (64 hex chars, secret ở cả 2 repo).
- `scripts/add-customer.ts` — CLI mã hóa entry, `randomBytes(12)` IV + AES-256-GCM.
- Email bị strip khỏi public invoice files (commit `cbf121f`).

### Per-invoice image build (`.github/workflows/customer-build.yml`)
1. Decrypt `customers.txt`, tìm invoice tương ứng.
2. Nướng `NEXORA_INVOICE_ID` + `NEXORA_INVOICE_EMAIL` vào docker image như build args.
3. Push 2 tag: versioned + rolling `latest-<invoiceId>` (commit `1d7550f`).

### Invoice gate (`backend/src/lib/invoice.ts`)
- `initInvoiceGate()` fetch `invoices/<id>.json` từ private releases repo lúc boot.
- Cache 24h, offline grace 7 ngày.
- `getInvoiceVerdict()` được check bởi `loadPlugins()`.

---

## 14. Install / deploy story

### One-command installer (`releases-template/install/install.sh`, commit `1effb12`)

```bash
curl -fsSL https://raw.githubusercontent.com/<owner>/nexora-releases/main/install/install.sh | bash
```

Trình tự:
1. Check prereq (docker, docker-compose, curl).
2. Tạo thư mục `nexora/`.
3. Download image customer-specific qua `GHCR_TOKEN` + rolling tag `latest-<invoice>`.
4. Download `docker-compose.yml`, `Caddyfile`, `.env.example`, `nexora.license`.
5. Copy `.env.example` → `.env`, prompt secret bắt buộc.
6. Auto pick `NODE_ENV` từ scheme của `PUBLIC_ORIGIN` — `https://` → `production`, `http://` → `development` (commit `b14a7c4`).
7. `docker compose up -d`.
8. Wait health, in admin URL.

### Manual fulfillment
`scripts/fulfill-order.sh --email=... --customer=... --tier=standard|lifetime`:
1. Sign `.license` qua `sign-license.ts`.
2. Copy `releases-template/` + compose + docs.
3. Write `.env.version` (pin image tag).
4. Tạo `releases/<email>_nexora-paid.zip`.
5. In hướng dẫn (cấp PAT, gửi email).

### Automated fulfillment (`.github/workflows/fulfill.yml`)
Trigger qua `repository_dispatch: order_paid` từ webhook proxy:
1. Validate payload (email, customer_id, tier, idempotency_key).
2. Idempotency check (skip nếu `<idem>.zip` đã upload).
3. Sign license.
4. Assemble ZIP (compose, Caddyfile, scripts, README = `CUSTOMER_ONBOARDING.md`).
5. Upload asset vào GitHub Release tag `fulfillments`.
6. Gửi HTML welcome email qua Resend API.

### Webhook proxy (`scripts/webhook-proxy/`)
Cloudflare Worker (`worker.js`, `wrangler.toml`):
- Verify webhook signature LemonSqueezy/Polar.
- Forward thành GitHub `repository_dispatch: order_paid`.
- Secret qua `wrangler secret put` (LEMONSQUEEZY_WEBHOOK_SECRET, GITHUB_PAT, GITHUB_REPO=`8w6s/nexora-paid`).

### Update system
```bash
docker compose -f docker-compose.yml -f docker-compose.updater.yml up -d
```

Flow: Admin UI → "Check now" → fetch `fileserver /v1/version` → "Apply" → backend POST unix socket → updater snapshot DB → pull image mới → `compose up` → healthcheck → rollback nếu fail.

### `fileserver/server.ts` (7.4 KB)
Bun server, endpoint:
- `GET /v1/version` — trả `stable.json` từ releases repo (cache 5 phút).
- `POST /v1/license` — verify license (Ed25519 signature + expiry + revoke list).
- `GET /v1/changelog/:version` — trả changelog markdown.

---

## 15. Cấu hình & configuration files

### Env

**`.env.example`** (root, 4 KB) document mọi biến với inline comment. Biến chính:

| Biến | Vai trò |
|---|---|
| `NODE_ENV` | `development` \| `production` |
| `PUBLIC_ORIGIN` | Phải HTTPS ở prod (ví dụ `https://shop.example.com`) |
| `DOMAIN` / `ADMIN_EMAIL` | Caddy Let's Encrypt config |
| `ADMIN_PASSWORD` / `ADMIN_PASSWORD_HASH` | argon2id hash khuyến nghị |
| `ORDER_TOKEN_SECRET` | HMAC sign guest order token (64 hex chars, required prod) |
| `DATABASE_ENCRYPTION_KEY` | AES-256 cho encrypted DB field (64 hex chars) |
| `NEXORA_LICENSE_SECRET` | AES key cho NXS1 snapshot encryption |
| `NEXORA_UPDATER_PSK` | Shared secret HMAC handshake với updater |
| `GHCR_TOKEN` | GitHub Container Registry PAT cho docker pull |
| `NEXORA_CUSTOMERS_KEY` | AES-256-GCM key cho customers.txt |
| `NEXORA_INVOICE_ID` / `NEXORA_INVOICE_EMAIL` | Nướng vào image lúc per-customer build |
| `NEXORA_RELEASES_REPO` | Ví dụ `8w6s/nexora-releases` |
| `NEXORA_FILESERVER_URL` | URL fileserver đã deploy |
| `CADDYFILE` | Switch giữa `./Caddyfile` và `./Caddyfile.tunnel` |
| `LTC_XPUB` | Litecoin extended public key (cũng có thể set qua Admin UI) |
| `BLOCKCYPHER_TOKEN` | Token optional cho rate limit |
| `EMAIL_PROVIDER` / `RESEND_API_KEY` / `SMTP_*` | Email delivery |
| `TRUST_PROXY` | Phải `true` khi ở sau reverse proxy (bắt buộc prod) |
| `NEXORA_ENABLE_RAW_SQL` | Enable raw SQL console (default `false`) |
| `NEXORA_ALLOW_GLOBAL_RATELIMIT_BUCKET` | Override yêu cầu TRUST_PROXY ở prod |

### Docker

**`docker-compose.yml`** (9.9 KB): service `caddy`, `backend`, `frontend`, `cloudflared` (profile `tunnel`), `backup` (profile `backup`). Named volumes: `nexora-db`, `nexora-keys`, `nexora-backups`, `caddy-data`, `caddy-config`. Mọi service `cap_drop: ALL`, `security_opt: no-new-privileges:true`, `tmpfs: /tmp`, `mem_limit`, `pids_limit`. Backend healthcheck: `bun -e "fetch('http://127.0.0.1:3000/api/health')"` mỗi 15s. 3 mode: local (default), DOMAIN+ACME, CF tunnel.

**`docker-compose.updater.yml`** (2.6 KB): overlay thêm `updater` service, mount docker socket + nexora-db volume, unix socket IPC.

**`backend/Dockerfile`** (4.8 KB): multi-stage `build-backend` + `build-frontend` + `runtime` (slim). Build args: `NEXORA_INVOICE_ID`, `NEXORA_INVOICE_EMAIL`, `NEXORA_RELEASES_REPO`, `PUBLIC_API_ORIGIN`, `PUBLIC_SITE_URL`.

**`frontend/Dockerfile`** (665B), **`fileserver/Dockerfile`** (779B), **`updater/Dockerfile`** (939B): standalone variant.

### Caddy
- **`Caddyfile`**: auto-HTTPS, route `/api/*` → `backend:3000`, còn lại → `frontend:4321`. Security headers, gzip/zstd.
- **`Caddyfile.tunnel`**: Cloudflare Tunnel mode, `auto_https off`, plain `:80`.

### CI/CD (`.github/workflows/`)
- **`release.yml`**: trigger trên tag `v*`. Build 4 docker image lên GHCR (`nexora:VERSION`, `nexora:VERSION-base`, `nexora-updater:VERSION`, `nexora-fileserver:VERSION`). Sign + publish `stable.json` vào private releases repo.
- **`fulfill.yml`**: trigger `repository_dispatch: order_paid` → ký license + assemble ZIP + upload asset + welcome email.
- **`customer-build.yml`**: per-invoice image build với `NEXORA_INVOICE_ID` baked-in, push rolling `latest-<invoice>` tag.

### Biome (`biome.json`, 1.8 KB)
Linter + formatter config. Import organization, TypeScript rule, replace ESLint + Prettier.

---

## 16. Snapshot encryption (NXS1)

`backend/src/lib/snapshot-crypto.ts` + `updater/snapshot-crypto.ts`:
- Format: `MAGIC(4) | nonce(12) | ciphertext | GCM-tag(16)` — magic bytes `NXS1`.
- Key: `HKDF-SHA256(licenseSecret ‖ machineId, salt="nexora-snapshot-v1", info="snapshot-key")` → 32 bytes.
- Machine-bound: copy snapshot sang host khác → decrypt fail.

Test: 13 case ở `backend/src/lib/snapshot-crypto.test.ts`.

---

## 17. Updater chi tiết (`updater/`)

Sidecar container, IPC qua unix socket.

- **`server.ts`** — main: endpoint `/apply`, `/status`, `/warm-pull`. Orchestrate snapshot → pull → compose-up → healthcheck → rollback.
- **`handshake.ts`** — PSK + HMAC + nonce auth (12 test case).
- **`manifest-verify.ts`** — Ed25519 manifest verify.
- **`snapshot-crypto.ts`** — NXS1 snapshot encryption.
- `package.json` không khai báo dep nào — dùng Bun native `node:crypto`, `node:child_process`, `node:fs`.

---

## 18. Tenant isolation

`backend/src/lib/tenant.ts` — path jail kiểu Android. Tách `/data/app/` (DB, secret, license) vs `/data/userspace/` (upload). Mọi request path đi qua `jailUserspace()` / `jailApp()` — reject null byte, parent traversal, absolute path.

Test: 18 case ở `backend/src/lib/tenant.test.ts`.

---

## 19. Notification system

`backend/src/lib/notifications.ts` — `registerNotifications()` gọi ở boot. Hỗ trợ Discord webhook, Telegram, generic webhook. SSRF guard trên admin-set webhook URL (security fix `f-notif-1`).

---

## 20. Scripts/package.json

### Root (`package.json`)
| Script | Command |
|---|---|
| `dev` | `bun scripts/tui.tsx` (OpenTUI dev runner) |
| `dev:backend` | `bun --cwd backend dev` |
| `dev:frontend` | `bun --cwd frontend dev` |
| `dev:legacy` | `bun scripts/dev.tsx` |
| `seed` | `bun --cwd backend src/db/seed.ts` |
| `format` | `biome format --write .` |
| `lint` | `biome lint .` |
| `check` | `biome check --write .` |
| `test:integrity` | `bun run scripts/test-integrity.ts` |
| `test:backend` | `cd backend && bun test src/lib/{hd,encryption,integrity,integrity-state,explorer}.test.ts src/lib/plugin/{compat,hook-bus,migrations}.test.ts` |
| `test:e2e` | `cd backend && bun run src/e2e.script.ts` |
| `test` | `bun run test:backend && bun run test:integrity` |
| `build:frontend` | `bun --cwd frontend run build` |

### Backend (`backend/package.json`)
| Script | Command |
|---|---|
| `dev` | `bun --watch src/index.ts` |
| `start` | `bun src/index.ts` |
| `db:push` | `drizzle-kit push` |
| `typecheck` | `tsc --noEmit` |

### Frontend (`frontend/package.json`)
| Script | Command |
|---|---|
| `dev` | `astro dev` |
| `build` | `astro build` |
| `preview` | `astro preview` |
| `typecheck` | `astro check` |

### Operational scripts (`scripts/`)
| Script | Vai trò |
|---|
| `sign-license.ts` | Phát hành signed Ed25519 `.license` |
| `sign-invoice.ts` | Sign invoice JSON |
| `sign-manifest.ts` | Build + sign integrity manifest |
| `verify-manifest.ts` | Verify signed manifest |
| `build-manifest.ts` | Build fresh `manifest.signed.json` |
| `test-integrity.ts` | Tamper smoke 3 pha |
| `add-customer.ts` | Encrypt entry cho `customers.txt` |
| `fulfill-order.sh` | Manual fulfillment |
| `gen-keypair.ts` | Generate Ed25519 keypair |
| `nexora-backup.sh` | Atomic SQLite online-backup |
| `nexora-restore-drill.sh` | Restore drill round-trip |
| `nexora-go-live-check.sh` | Pre-launch preflight |
| `nexora-support-bundle.sh` | Redacted diagnostics tarball |
| `backup-cron.sh` | Entry cho compose profile `backup` |
| `dev.tsx` | Legacy TUI dev runner |
| `tui.tsx` + `tui/` | OpenTUI TUI cho `bun run dev` |
| `i18n-diff.py` | Tìm gap i18n |
| `sync-i18n-to-backend.sh` | Sync FE → BE locale |
| `reset-shop-identity.ts` | Reset storefront identity |
| `cleanup-test-products.ts` | Xóa product test/seed |

---

## 21. Test coverage

### Framework
**Bun built-in test runner** (`bun test`). E2E qua custom script.

### Backend unit tests (`backend/src/lib/`)
| File | Nội dung |
|---|---|
| `hd.test.ts` | HD address derivation (19 check) |
| `encryption.test.ts` | AES-256-GCM round-trip |
| `integrity.test.ts` | Manifest verifier (13 test, 27 expect) |
| `integrity-state.test.ts` | Boot integrity state machine |
| `explorer.test.ts` | BlockCypher/litecoinspace API |
| `sanitize.test.ts` | Input sanitize |
| `snapshot-crypto.test.ts` | 13 case NXS1 |
| `updater-handshake.test.ts` | 12 case handshake |
| `tenant.test.ts` | 18 case path jail |
| `catbox.test.ts` | 10 case |
| `plugin/compat.test.ts` | Semver compat |
| `plugin/hook-bus.test.ts` | Pub/sub |
| `plugin/migrations.test.ts` | Migration runner |

### Route tests
- `routes/admin-db.test.ts` — SQL console
- `routes/health.test.ts` — health endpoint

### Integration tests
- `backend/src/e2e.script.ts` — full backend e2e (17 check), cần running server.

### Frontend tests
- `frontend/src/i18n/parity.test.ts` — parity 5 locale.

### Integrity smoke test
- `scripts/test-integrity.ts` — 3 pha: build manifest fresh → tamper file → tamper payload. Byte-exact restore ở `finally`, safe re-run.

CHANGELOG v1.1.0 claim **88 lib tests** total.

---

## 22. Workspace / monorepo setup

**Loại**: Bun native workspaces (không phải Turborepo, không phải pnpm).

```json
{
  "name": "nexora",
  "private": true,
  "workspaces": ["frontend", "backend"]
}
```

`bun install` ở root cài cho cả workspace. `bun.lock` ở root cover toàn workspace. Mỗi workspace có `package.json` + `tsconfig.json` riêng.

**Nested repo (không phải submodule, có `.git` riêng)**:
- `gstack/` — gstack AI toolkit (lịch sử git riêng)
- `mimocode-src/` — Mimocode source (lịch sử git riêng)
- `pixel-agents/` — Pixel Agents extension (lịch sử git riêng)

Không xuất hiện trong `.gitmodules` — đây là nested git repo "inner" chứ không phải submodule.

---

## 23. Security hardening (post-audit June 2026)

Một loạt commit `fix(security)` xử lý kết quả deep audit:

| ID | Sửa |
|---|---|
| `f-audit-1` | Log product-key deletion vào `admin_actions` |
| `f-notif-1` | SSRF guard trên admin-set notification webhook |
| `f-integrity-1` | Refuse `NEXORA_DEV_SKIP_INTEGRITY` ở production |
| `f-frontend-1` | Security headers baseline mọi Astro response (middleware.ts) |
| `f-6` | Refuse boot prod nếu không có `TRUST_PROXY=true` |
| `f-11` | Yêu cầu verify TOTP code trước khi bind customer 2FA secret |
| `f-13` | Yêu cầu re-auth trước khi tắt admin 2FA |
| `f-14` | Fail-loud khi SMTP misconfigure ở production |
| `f-16` | Block write vào sensitive table qua generic admin table editor |
| `f-link-prompt` | Modal-backed link prompt + scheme allowlist trong RichTextEditor |

---

## 24. Rate limiting architecture

`backend/src/lib/rate-limit.ts` — in-memory sliding-window, per-key bucket.
`clientIp()` chỉ honor `X-Forwarded-For` khi `(globalThis as any).__nexora_trust_proxy === true`.

Endpoint với limit riêng:
- Login: 10/min
- Reset: 8/15min
- Log-error: 30/min
- DB editor: 30/min
- Blocklist: 60/min
- SSE connection: cap 5/key

---

## 25. Dev TUI

`scripts/tui/`:
- `index.tsx` — main TUI layout
- `db.ts` — SQLite state reader
- `logo.tsx` — ASCII logo
- `processes.ts` — spawn + monitor backend + frontend
- `stary-background.tsx` — animated starfield
- `theme.ts` — color theme

TUI wrap cả 2 dev process với realtime log stream + process health indicator.

---

## 26. Tài liệu (`docs/`)

| File | Nội dung |
|---|---|
| `DEPLOYMENT.md` | 3 mode Docker (local / DOMAIN+ACME / CF Tunnel) |
| `PRODUCTION.md` | Pre-launch checklist, scaling, monitoring, backup |
| `SECURITY_ARCHITECTURE.md` | 25 KB deep-dive design |
| `PLUGIN_DEV.md` | Plugin v2 contract, manifest, lifecycle, migration |
| `UPDATE_SYSTEM.md` | Auto-update architecture + operator setup |
| `LICENSE_OPS.md` | Issue/revoke/inspect license |
| `LICENSE_ROTATION.md` | Key rotation + incident response |
| `INVOICE_FLOW.md` | Per-customer build + invoice flow |
| `CUSTOMER_ONBOARDING.md` | README ship trong fulfillment ZIP |
| `CLUSTERS.md` | Feature cluster roadmap (A done, F done, C planned) |
| `MVP_SCOPE.md` | Scope decision vs SellAuth (tiếng Việt) |
| `RELEASE_CHECKLIST.md` | Pre-ship checklist |
| `MIGRATION_POSTGRES.md` | SQLite → PostgreSQL (experimental) |
| `UPGRADE_PLAN.md` / `UPGRADE_PLAN_V2.md` | V2 roadmap (historical) |
| `audit/FIX_REPORT_2026-06-15.md` | Deep audit fix report |

---

## 27. Khóa bí mật (`.keys/`, gitignored)

| File | Vai trò |
|---|---|
| `customers.key` | 64-hex AES-256 cho `customers.txt` (`nx1:` format) |
| `db_encryption.key` | 64-hex AES-256 cho DB field encryption |
| `license-signer.private` | Ed25519 private (32 bytes hex) |
| `license-signer.public` | Ed25519 public (32 bytes hex) |

Plus `backend/.keys/db_encryption.key` (copy/symlink runtime cho Docker).

`nexora.license` (root) và `issued/test_nexora_local.license` đều là test license 302 byte cho dev.

---

## 28. AI dev infrastructure (không phải app Nexora)

- **`gstack/`** — full gstack AI toolkit, 40+ skill (browse, design-review, investigate, qa, cso…). Có `CLAUDE.md`, `ARCHITECTURE.md`, `VERSION` riêng.
- **`pixel-agents/`** — Pixel Agents VS Code extension.
- **`mimocode-src/`** — Mimocode IDE source.
- **`.claude/`** — Claude Code settings, workflow (nexora-deep-audit.js, nexora-team-sprint.js, startup-sprint.js, team-loop.js), team-mcp MCP server, worktrees.
- **`.loop/`** — AI loop state: `BACKLOG.md` (feature backlog), `JOURNAL.md` (32 KB running log), `PROMPT.md` (14 KB instructions).
- **`.mimocode/`** — local Mimocode agent/command (code-reviewer, security-auditor, test-engineer, web-performance-auditor).

---

## 29. Dev gotchas (từ CONTEXT.md)

- `bun --watch src/index.ts` đôi khi không pick up change nếu nhiều process stale share `:3000` (Windows SO_REUSEADDR). Sau khi edit backend, `netstat -ano | grep :3000` phải thấy **một** PID. Nếu nhiều → taskkill stale.
- Same cho Astro frontend sau khi install dep — clear `frontend/node_modules/.vite` + restart `bun run dev:frontend` để force re-optimize.
- Admin login (current DB): `satoharuki2321@proton.me` (password unknown to docs — reset qua DB nếu cần).
- Default từ `.env.example`: `admin@myshop.test` / `admin12345` chỉ apply trên fresh-bootstrap DB.
- DB hiện có: 10 product + 4 category + WELCOME10 coupon + FREE (100% percent) + nhiều order/customer QA.
- xpub đã seeded — checkout hoạt động.

---

## 30. Build & ship commands (quick reference)

```bash
# Local dev (TUI runner)
bun install
bun run dev

# Hoặc chia tách
bun run dev:backend     # cổng 3000
bun run dev:frontend    # cổng 4321

# Seed DB
bun run seed

# Test
bun run test            # backend lib + integrity smoke
bun run test:backend
bun run test:integrity
bun run test:e2e        # cần backend đang chạy

# Lint/format
bun run check           # biome check --write .
bun run format
bun run lint

# Build production
bun run build:frontend
docker compose build

# Production stack (3 mode)
docker compose up -d                                # local mode
DOMAIN=shop.example.com docker compose up -d        # auto-HTTPS
CADDYFILE=./Caddyfile.tunnel docker compose --profile tunnel up -d

# Update orchestration
docker compose -f docker-compose.yml -f docker-compose.updater.yml up -d

# Ops
bash scripts/nexora-backup.sh
bash scripts/nexora-restore-drill.sh
bash scripts/nexora-go-live-check.sh
bash scripts/nexora-support-bundle.sh
```

---

## 31. CHANGELOG tóm tắt

- **1.0.0 (2026-06-25)** — Initial public release. Bun + Elysia + SQLite + Astro + React 19. LTC HD payments. Ed25519 license + revoke. Plugin v2. Integrity manifest. NXS1 snapshot. Auto-update + rollback. 5 locale i18n. SellAuth-parity admin.
- **1.1.0 (Unreleased)** — Hardening sâu: 88 lib test, SSRF guard, CSRF baseline, integrity dev-skip refuse ở prod, TOTP hardening (`f-11`, `f-13`), TRUST_PROXY enforce, generic table editor block sensitive write, RichTextEditor link prompt modal + scheme allowlist, encrypt customers.txt, one-command installer, NODE_ENV auto-pick, rolling `latest-<invoice>` tag.

---

## 32. Trạng thái hiện tại

- Repository branch: `main`.
- Git user: `8w6s`.
- Last commit: `b14a7c4 fix(install): auto-pick NODE_ENV from PUBLIC_ORIGIN scheme`.
- Một số untracked file (`add-i18n.js`, `backend/src/main.ts`, `home-after.png`, `native-editor-final.png`, `test-pay-page.png`, `pixel-agents/`, `gstack/`) — phần lớn là asset/screenshot/nested repo.
- Feature core đã hoàn thiện; công việc gần đây là UX polish + SellAuth-parity + security hardening.

---

*Hết tài liệu. Mọi mục đối chiếu trực tiếp với code/repo state lúc 2026-06-28.*