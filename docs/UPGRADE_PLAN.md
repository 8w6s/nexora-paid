# GemVN — Kế hoạch nâng cấp lên web bán hàng digital quốc tế (LTC)

> Tài liệu thiết kế để **duyệt trước khi code**. Sản phẩm của một workflow ~15 sub-agent (research + kiểm chứng đối kháng + thiết kế). Mọi đoạn code dưới đây là *bản phác cài đặt*, chưa được áp vào repo.

---

## 1. Tóm tắt điều hành

Nâng cấp shop hiện tại (Elysia + Bun + Drizzle/SQLite ở backend; Astro + React islands ở frontend) từ một demo bán hàng nội địa (VietQR/VND, không tài khoản, admin chỉ xem) thành **web thương mại điện tử quốc tế đầy đủ**:

- **Giao diện tiếng Anh, niêm yết giá USD**, quy đổi sang **Litecoin (LTC)** theo tỷ giá realtime tại lúc thanh toán.
- **Ví HD (xpub)**: admin dán *extended public key*; mỗi đơn sinh **một địa chỉ con duy nhất** (private key không bao giờ nằm trên server).
- **Tự động xác nhận thanh toán** bằng cách poll blockchain explorer; đủ tiền + đủ confirmations → tự giao key.
- **Kho key thật**: admin dán kho mã/tài khoản cho từng sản phẩm; bán xong giao đúng mã có sẵn; hết kho → báo hết hàng.
- **Tài khoản khách hàng** (email + mật khẩu, session cookie HttpOnly) + trang "My Orders".
- **Admin** đăng nhập (credentials trong `.env`): CRUD sản phẩm, nạp kho key, quản lý đơn, dashboard doanh thu, cấu hình ví/SMTP.
- **SEO chuẩn quốc tế** (sitemap, JSON-LD, OG/Twitter, canonical, Core Web Vitals).
- **Email tùy chọn** (bật/tắt được — Resend hoặc SMTP).
- Vẫn giữ **SQLite** (1 file, importable).

---

## 2. Các quyết định đã chốt (không mâu thuẫn)

| # | Hạng mục | Quyết định |
|---|---|---|
| 1 | Ngôn ngữ / Tiền tệ | Tiếng Anh + USD; quy đổi LTC realtime tại checkout |
| 2 | Ví LTC | HD wallet qua **xpub** (Ltub/Mtub/zpub); mỗi đơn 1 địa chỉ con; không có private key trên server |
| 3 | Xác nhận thanh toán | **Tự động** qua blockchain explorer API (poll địa chỉ) |
| 4 | Kho key | Admin nhập **kho key thật**; hết kho → out of stock |
| 5 | Auth khách | Email + mật khẩu (hash), session cookie HttpOnly |
| 6 | Email/SMTP | **Tùy chọn**, bật/tắt được (Resend hoặc SMTP); key vẫn hiện on-site |
| 7 | Database | Giữ **SQLite/libsql** |
| 8 | Admin auth | 1 tài khoản admin, credentials trong `.env` → session |

---

## 3. Kiến trúc tổng thể

```
                 ┌───────────────────────────── Frontend (Astro 5) ─────────────────────────────┐
                 │  Static-first: Home, Catalog, Product (SEO + JSON-LD)  →  prerender             │
                 │  Server (prerender=false): Checkout, My Orders, Login/Register, Admin           │
                 │  React islands: Cart, Checkout(LTC pay), Auth forms, Admin CRUD/dashboard        │
                 │  api client: BASE_URL từ env (BỎ hardcode localhost:3000), fetch credentials     │
                 └───────────────────────────────────────────────┬─────────────────────────────────┘
                                                                  │  cookie sid/asid (HttpOnly)
                 ┌────────────────────────────── Backend (Elysia + Bun) ───────────────────────────┐
                 │  Auth (argon2id + opaque DB session)   Catalog   Checkout   Orders(IDOR-safe)    │
                 │  Admin: products CRUD, key inventory, orders, stats, settings                    │
                 │  rate.ts  (USD→LTC, cache 60s, lock per-order)                                   │
                 │  hd.ts    (@scure/bip32 → địa chỉ con từ xpub)                                   │
                 │  watcher  (poll explorer → paid → giao key, idempotent, restart-recovery)        │
                 │  email    (no-op khi tắt; Resend|SMTP)                                           │
                 └───────────────────────────────────────────────┬─────────────────────────────────┘
                                                                  │
                          Drizzle ORM → SQLite (users, sessions, products, product_keys,
                                                 orders, order_items, settings)
                          External: Kraken/Coinbase (rate) · BlockCypher/litecoinspace (explorer)
```

---

## 4. Database schema (Drizzle / SQLite) — đầy đủ

Mở rộng **additive** trên 2 bảng cũ (`products`, `orders` giữ nguyên cột cũ để không phá dữ liệu/đọc cũ trong lúc cutover) + thêm 5 bảng mới. **Stock không lưu nữa** — suy ra từ `count(product_keys WHERE status='available')`.

```ts
import { sqliteTable, text, integer, real, index, uniqueIndex } from "drizzle-orm/sqlite-core";
import { sql, relations } from "drizzle-orm";

/* users — danh tính đăng nhập */
export const users = sqliteTable("users", {
  id: text("id").primaryKey(),
  email: text("email").notNull(),
  passwordHash: text("password_hash").notNull(),      // argon2id — không bao giờ plaintext
  role: text("role").$type<"customer" | "admin">().default("customer").notNull(),
  createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull().default(sql`(unixepoch()*1000)`),
}, (t) => [ uniqueIndex("users_email_unique").on(sql`lower(${t.email})`) ]);

/* sessions — cookie value === sessions.token (opaque 256-bit). Lưu SHA-256(token), không lưu token thô */
export const sessions = sqliteTable("sessions", {
  token: text("token").primaryKey(),
  userId: text("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  expiresAt: integer("expires_at", { mode: "timestamp_ms" }).notNull(),
  createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull().default(sql`(unixepoch()*1000)`),
}, (t) => [ index("sessions_user_idx").on(t.userId), index("sessions_expiry_idx").on(t.expiresAt) ]);

/* products — priceUsd canonical; slug cho SEO URL; active = soft-hide */
export const products = sqliteTable("products", {
  id: text("id").primaryKey(),
  slug: text("slug").notNull(),
  name: text("name").notNull(),
  description: text("description").notNull(),
  priceUsd: real("price_usd").notNull().default(0),
  image: text("image").notNull(),
  category: text("category").notNull(),
  active: integer("active", { mode: "boolean" }).notNull().default(true),
  sold: integer("sold").notNull().default(0),         // counter hiển thị, KHÔNG phải tồn kho
  createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull().default(sql`(unixepoch()*1000)`),
  // (giữ cột cũ price/stock để migration additive — không còn dùng)
}, (t) => [
  uniqueIndex("products_slug_unique").on(t.slug),
  index("products_category_idx").on(t.category),
  index("products_active_idx").on(t.active),
]);

/* product_keys — KHO THẬT. 1 row = 1 mã bán được */
export const productKeys = sqliteTable("product_keys", {
  id: text("id").primaryKey(),
  productId: text("product_id").notNull().references(() => products.id, { onDelete: "cascade" }),
  code: text("code").notNull(),                       // mã/tài khoản giao cho khách
  status: text("status").$type<"available" | "reserved" | "delivered">().notNull().default("available"),
  orderId: text("order_id").references(() => orders.id, { onDelete: "set null" }),
  createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull().default(sql`(unixepoch()*1000)`),
}, (t) => [
  index("product_keys_product_status_idx").on(t.productId, t.status),   // count + pick nhanh
  index("product_keys_order_idx").on(t.orderId),
  uniqueIndex("product_keys_product_code_unique").on(t.productId, t.code),
]);

/* orders — pricing/rate-lock + HD address + settlement state */
export const orders = sqliteTable("orders", {
  id: text("id").primaryKey(),
  userId: text("user_id").references(() => users.id, { onDelete: "set null" }), // NULL = guest
  status: text("status").$type<"pending"|"awaiting_payment"|"paid"|"completed"|"expired"|"cancelled"|"underpaid">().notNull().default("pending"),
  // rate lock (đóng băng lúc checkout)
  totalUsd: real("total_usd").notNull(),
  ltcRate: real("ltc_rate").notNull(),                // USD-per-LTC đã khóa
  ltcAmount: text("ltc_amount").notNull(),            // LTC kỳ vọng, chuỗi 8dp (hiển thị)
  expectedLitoshi: integer("expected_litoshi").notNull(), // target nguyên để so khớp (1 LTC=1e8)
  rateSource: text("rate_source"),
  // HD address (watch-only)
  addressIndex: integer("address_index").notNull(),
  ltcAddress: text("ltc_address").notNull(),
  // settlement (poller ghi)
  receivedLitoshi: integer("received_litoshi").notNull().default(0),
  confirmations: integer("confirmations").notNull().default(0),
  paidTxId: text("paid_tx_id"),
  createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull().default(sql`(unixepoch()*1000)`),
  paidAt: integer("paid_at", { mode: "timestamp_ms" }),
  deliveredAt: integer("delivered_at", { mode: "timestamp_ms" }),
  expiresAt: integer("expires_at", { mode: "timestamp_ms" }).notNull(),   // hết cửa sổ thanh toán
  // (giữ cột cũ total_amount/items/delivered_content/customer_* để migration additive)
}, (t) => [
  index("orders_status_idx").on(t.status),
  index("orders_user_idx").on(t.userId),
  index("orders_expires_idx").on(t.expiresAt),
  uniqueIndex("orders_ltc_address_unique").on(t.ltcAddress),     // không tái dùng địa chỉ
  uniqueIndex("orders_address_index_unique").on(t.addressIndex), // không tái dùng index
]);

/* order_items — line items chuẩn hóa, snapshot name+price */
export const orderItems = sqliteTable("order_items", {
  id: text("id").primaryKey(),
  orderId: text("order_id").notNull().references(() => orders.id, { onDelete: "cascade" }),
  productId: text("product_id").notNull().references(() => products.id, { onDelete: "restrict" }),
  name: text("name").notNull(),
  priceUsd: real("price_usd").notNull(),
  quantity: integer("quantity").notNull(),
}, (t) => [ index("order_items_order_idx").on(t.orderId), index("order_items_product_idx").on(t.productId) ]);

/* settings — key/value. Secrets ưu tiên .env; DB giữ toggle + config không nhạy cảm */
export const settings = sqliteTable("settings", {
  key: text("key").primaryKey(),
  value: text("value"),
  updatedAt: integer("updated_at", { mode: "timestamp_ms" }).notNull().default(sql`(unixepoch()*1000)`),
});
// seed keys: ltc_xpub, hd_address_type, hd_next_index, required_confirmations(2),
//            payment_window_minutes(15), rate_tolerance_litoshi(1000), store_name,
//            email_enabled, email_provider, email_from, resend_api_key/smtp_* (ưu tiên env)

// + relations() cho mọi bảng (users↔sessions/orders, products↔keys/order_items, orders↔items/keys)
```

**Cấp phát `addressIndex` (an toàn race):** trong transaction tạo đơn — đọc `settings.hd_next_index`, +1, derive địa chỉ con từ xpub, insert đơn. UNIQUE trên `ltc_address` + `address_index` là lưới an toàn cứng: nếu 2 request đua nhau, insert thứ 2 vi phạm UNIQUE → rollback (không tái dùng địa chỉ). Index chỉ tiến, không recycle.

**Stock & reserve:** checkout (1 transaction) chọn `qty` key `available` → đổi sang `reserved` (gắn `orderId`). Paid → `reserved`→`delivered` + bump `sold`. Cancel/expire → trả `reserved`→`available`.

**Migration:** `bunx drizzle-kit generate` → review SQL (đảm bảo ADD COLUMN, không DROP) → `migrate`. Backfill: `products.price`→`price_usd`, `orders.items` JSON→`order_items` rows, seed `settings` + `hd_next_index=0`.

---

## 5. API surface (Elysia)

Quy ước: JSON in/out; tiền hiển thị = USD, tiền so khớp = **litoshi (nguyên)**; lỗi `{ error, code }`; auth qua cookie HttpOnly `sid` (customer) / `asid` (admin). Mức auth: **public | customer | admin | owner**.

**Public — Catalog**
| Method | Path | Auth | Behavior |
|---|---|---|---|
| GET | `/api/products?category=` | public | List sản phẩm `active`; `stock`/`inStock` suy từ count key `available` |
| GET | `/api/products/:id` (hoặc `:slug`) | public | Chi tiết 1 sản phẩm + stock thật |

**Public — Auth**
| Method | Path | Auth | Behavior |
|---|---|---|---|
| POST | `/api/auth/register` | public | `{email,password(min8)}` → hash argon2id, 409 nếu trùng, auto-login (set `sid`) |
| POST | `/api/auth/login` | public | verify constant-time, 401 generic, rate-limited |
| POST | `/api/auth/logout` | customer | xóa session, clear cookie |
| GET | `/api/auth/me` | public | `{user:{id,email,role}}` khi đã login, `{user:null}` khi guest (200 trong cả 2 trường hợp — session-status query, không phải protected resource) |

**Customer — Checkout & Orders**
| Method | Path | Auth | Behavior |
|---|---|---|---|
| POST | `/api/checkout` | customer | **Chỉ tin server**: re-fetch product, verify active + đủ key, tính `priceUsd` từ DB. Khóa rate (Kraken→Coinbase→last-good). `expectedLitoshi = Math.round((totalUsd/usdPerLtc)*1e8)`. Derive địa chỉ con duy nhất. Reserve key. Insert đơn (`pending`, window = now+N phút). Trả `{orderId,ltcAddress,ltcAmount,expectedLitoshi,qrCodeUrl,usdLtcRate,rateExpiresAt}` |
| GET | `/api/orders` | customer | **Scoped** `WHERE userId = session.userId` — không bao giờ trả đơn người khác |
| GET | `/api/orders/:id` | owner | **IDOR-safe**: `WHERE id=? AND userId=?`; lệch → **404 (không 403)** để không lộ tồn tại; key chỉ hiện sau paid |
| GET | `/api/orders/:id/status` | owner | Endpoint **polling** nhẹ cho trang pay; chỉ đọc DB (watcher cập nhật), không gọi explorer mỗi request |

**Admin** (`asid`): `POST /api/admin/login|logout`; products CRUD `GET/POST/PATCH/DELETE /api/admin/products[/:id]` (DELETE = soft `active=0`); **kho key** `POST /api/admin/products/:id/keys {codes:[...]}` (bulk insert `available`, dedup) + `GET .../keys?status=` + `DELETE .../keys/:keyId` (chặn nếu đã `delivered`); orders `GET /api/admin/orders?status=&page=`, `GET .../:id`, `POST .../:id/mark-paid` (dùng **cùng transition idempotent** với watcher), `POST .../:id/refund-note`; stats `GET /api/admin/stats` + `GET /api/admin/stats/revenue?bucket=day|week|month`; settings `GET/PUT /api/admin/settings` (**mask secrets**, validate xpub prefix + parse bằng @scure/bip32 trước khi lưu) + `PUT /api/admin/settings/email` (verify SMTP/Resend **trước khi** bật).

---

## 6. Luồng thanh toán LTC (đã kiểm chứng đối kháng live 2026-06-01)

### 6.1 HD wallet — derive địa chỉ từ xpub
Dùng **`@scure/bip32` + `@scure/base` + `@noble/hashes`** (thuần JS, chạy tốt trên Bun; **tránh** `bitcoinjs-lib` vì cần WASM `tiny-secp256k1` và không có sẵn network Litecoin).

- Phát hiện loại từ prefix → **chọn version bytes + loại địa chỉ**:
  - `Ltub` (0x019da462) / `xpub` → BIP44 P2PKH → địa chỉ `L...`
  - `Mtub` (0x01b26ef6) / `ypub` → BIP49 P2SH-P2WPKH → địa chỉ `M...`
  - `zpub` (0x04b24746) → BIP84 P2WPKH → địa chỉ `ltc1...`
- ⚠️ **Lưu ý từ verify:** `zpub` là prefix BIP84 **chung (Bitcoin)**, *không* riêng Litecoin — nhiều ví LTC tái dùng `zpub` của Bitcoin cho bech32. **Pin theo prefix ví thật của bạn**, đừng giả định.
- Litecoin mainnet: pubKeyHash `0x30`, scriptHash `0x32`, bech32 HRP `ltc`.
- Derive external chain `m/0/i` (non-hardened — chạy được trên public-only key). xpub là account key (depth 3).
- **UX an toàn:** sau khi admin dán xpub, hiển thị **địa chỉ index 0** để admin đối chiếu với ví trước khi go-live.

### 6.2 Tỷ giá USD→LTC
- **Primary: Kraken** `GET /0/public/Ticker?pair=LTCUSD` (không key, LTC/USD thật). **Fallback: Coinbase** `/v2/prices/LTC-USD/spot`. **Tránh CoinCap** (đã sunset) và Binance LTC**USDT** cho settlement (USDT≠USD).
- Cache process-wide ~60s; **khóa rate per-order** lúc checkout (lưu `ltcRate`, `expectedLitoshi`, `expiresAt`) — không re-quote đơn đang chạy.
- Làm tròn LTC 8dp, **làm tròn LÊN** số tiền nợ để khách không bao giờ trả thiếu do truncation. Cửa sổ 15–20 phút.

### 6.3 Watcher (poll explorer → paid → giao key)
- **Primary: BlockCypher** `GET /v1/ltc/main/addrs/{addr}/balance` (keyless; `total_received`, `unconfirmed_balance` theo **litoshi**); chỉ khi có tiền mới gọi `/addrs/{addr}` lấy `confirmations` per-tx. **Fallback: litecoinspace.org** (Esplora fork): `received = chain_stats.funded_txo_sum`, `confirmations = tipHeight − block_height + 1` (lấy `/blocks/tip/height` tươi).
- ⚠️ **Sửa từ verify:** batch nhiều địa chỉ của BlockCypher dùng **dấu chấm phẩy** `;` (`/addrs/a;b;c/balance`), KHÔNG phải dấu phẩy. **Đăng ký free token** để có hạn mức cao hơn + accounting. Hạn mức free ~100–200 req/hr (con số dao động — thiết kế backoff 429/5xx, đừng hardcode).
- ⚠️ **Blockchair keyless không đáng tin** (trả HTTP 430 "IP blacklisted" lần 2) → chỉ best-effort, coi như cần API key.
- **Quyết định mỗi tick:** `enoughAmt = received >= expectedLitoshi − TOLERANCE` (≈0.00001 LTC); `enoughConf = maxConf >= required` (mặc định **2**, ~5 phút; cân nhắc 4–6 cho đơn lớn). **Người gửi trả phí mạng → KHÔNG trừ phí** khỏi expected.
  - `enoughAmt && enoughConf` → **transition idempotent**: `UPDATE orders SET status='paid',... WHERE id=? AND status IN ('pending','underpaid','awaiting_payment')`. **Chỉ khi affected==1**, trong cùng transaction: `reserved`→`delivered`, ghi key giao, bump `sold`. → chống double-deliver khi nhiều tick/đua với admin mark-paid.
  - `received>0` nhưng thiếu → `underpaid` (không giao; UI báo "short by X LTC").
  - 0-conf/mempool → để `pending` ("đã thấy — chờ xác nhận"). **Không bao giờ giao khi chưa confirm.**
- **Cadence:** loop ~30s, `Bun.sleep(350)` giữa các địa chỉ; mở rộng interval khi nhiều đơn.

### 6.4 State machine & restart-recovery
`pending → awaiting_payment → paid → completed`, cộng `underpaid / expired / cancelled`. **Recovery DB-driven** (không phụ thuộc timer in-memory): lúc khởi động quét đơn non-terminal — `pending/underpaid` còn hạn → tick kế tiếp tự xử; quá hạn → `expired` + trả key; `paid` (có thể crash giữa chừng) → chạy lại bước giao **idempotent** (guard affected==1 + idempotency key email) → no-op nếu đã giao. Mọi state (địa chỉ, expected, rate) đã **persist trên row đơn** nên restart không mất gì.

---

## 7. Bảo mật

- **Mật khẩu:** `Bun.password` (argon2id, built-in — không cần npm). Pin params (vd `memoryCost:19456, timeCost:2`), thêm đường "needs-rehash". Anti-enumeration: khi email không tồn tại vẫn verify với 1 dummy hash để cân bằng timing.
- **Session:** **opaque token DB** (không JWT — cần revoke tức thì vì session gate quyền truy cập key đã mua). Sinh 256-bit random; **lưu SHA-256(token) trong DB**, cookie chỉ giữ token thô (DB leak không mint được session). Cookie `HttpOnly + Secure + SameSite=Lax + Path=/`, ~30 ngày, sliding renewal. `Secure` gate theo env để dev qua `http://localhost` không rớt cookie.
- **Admin:** `ADMIN_EMAIL` + `ADMIN_PASSWORD_HASH` (hash, không plaintext) trong `.env`; lúc boot upsert 1 user `role='admin'` → dùng chung 1 đường session. `requireAdmin` chỉ check `role==='admin'`.
- **IDOR (lỗi hiện tại):** `GET /api/orders` đang trả TẤT CẢ, `/:id` trả bất kỳ đơn nào → fix: bắt buộc auth, scope list theo caller, ownership-check detail, trả **404** khi không sở hữu. Order id hiện đoán được (`GG-<6 số>-<3 số>`) → dùng id không đoán được hoặc yêu cầu tài khoản để mua.
- **CSRF:** SameSite=Lax + check `Origin` header (allowlist) trên mọi verb thay đổi state; không bao giờ đổi state qua GET.
- **CORS:** thay `cors()` trần bằng `cors({ origin: PUBLIC_ORIGIN, credentials: true })`; frontend fetch `credentials:'include'`.
- **Rate limit login:** in-memory Map theo IP+email + lockout/backoff, lỗi generic.
- **Không tin giá client:** mọi giá/tổng tính lại từ DB ở server (đã phản ánh trong `/api/checkout`).

```ts
// auth/macros.ts — Elysia 1.4 macro/resolve
export const auth = new Elysia({ name: "auth" }).macro({
  requireAuth: { cookie: t.Cookie({ session: t.Optional(t.String()) }),
    async resolve({ cookie:{session}, status }) {
      const user = session.value ? await validateSession(session.value) : null;
      if (!user) return status(401, "Authentication required");
      return { user };
    } },
  requireAdmin: { /* …như trên… + if (user.role!=='admin') return status(403) */ },
});
```

---

## 8. Frontend — trang & component (Astro 5 + React islands)

> Phần này tôi tự bổ sung (2 sub-agent frontend/payment chi tiết bị treo nên tôi dựng từ research SEO + API + codebase hiện có). Sẽ chi tiết hóa thêm khi triển khai.

**Mô hình render:** `output: 'static'` mặc định, thêm server adapter; chỉ route động đánh `prerender = false`.

| Trang | Route | Render | Island | Ghi chú |
|---|---|---|---|---|
| Home | `/` | static | (featured) | Hero + featured + categories, SEO |
| Catalog | `/shop`, `/category/[slug]` | static | Filter/Search island | Lọc category, search, paginate |
| Product | `/product/[slug]` | **static** (getStaticPaths) | Buy/AddToCart island | SEO-rich + **JSON-LD** Product/Offer/Breadcrumb |
| Cart | drawer toàn cục | — | CartDrawer | Chia sẻ `CartContext` |
| Checkout | `/checkout` | server (`prerender=false`) | CheckoutLTC | Yêu cầu đăng nhập; hiện địa chỉ LTC + **QR** (`litecoin:<addr>?amount=`) + status polling + countdown; xử lý underpaid/expired |
| Auth | `/login`, `/register` | server | AuthForm | Email+password, lỗi inline |
| My Orders | `/orders`, `/orders/[id]` | server | OrdersView | List scoped + detail + **key đã giao** |
| Admin | `/admin/*` | server | AdminApp | Login, dashboard doanh thu (chart), Products CRUD + **textarea dán kho key**, Orders, Settings (dán xpub + confirmations + window + SMTP) |

- **api client:** 1 module đọc `BASE_URL` từ env (`import.meta.env.PUBLIC_API_ORIGIN`) — **bỏ hardcode `http://localhost:3000`** đang rải khắp nơi; mọi fetch `credentials:'include'`.
- **Context:** `AuthContext` (user/me) + `CartContext` (giỏ, chia sẻ giữa các island).
- **SEO layer:** component `SEO.astro` tái dùng (title/description/canonical/OG/Twitter) + `@astrojs/sitemap` (cần `site`) + `public/robots.txt` (disallow `/admin /orders /checkout /api`, link sitemap) + JSON-LD per-product. `Offer.priceCurrency = "USD"` (schema cần fiat ISO 4217; chỉ hiện LTC ở UI checkout). **Không bịa AggregateRating** (vi phạm chính sách Google) — chỉ thêm khi có review thật. Canonical/OG dùng `Astro.site` (diệt luôn vấn đề localhost).
- **CWV:** preload font chính + `font-display:swap`; ảnh dưới màn `loading="lazy"` + width/height; dùng `astro:assets <Image>` (WebP/AVIF).
- ⚠️ `getStaticPaths` chạy lúc build → sản phẩm mới thêm qua admin chỉ xuất hiện sau rebuild. Phương án: trigger rebuild khi đổi kho, hoặc server-render catalog (đánh đổi SEO/perf). **→ câu hỏi mở #2.**

---

## 9. Email tùy chọn

1 abstraction `EmailService` với discriminant `provider: 'resend'|'smtp'|null`. Khi `enabled=false` hoặc thiếu secret → mọi hàm trả `{skipped:true}` (no-op, không import dependency). **Default: Resend** (HTTP/fetch, Bun-native, chỉ cần outbound HTTPS); **fallback: Nodemailer SMTP** (cho self-host). Lazy `await import()` provider trong đường gửi. **Idempotency key = `${type}/${orderId}`** để watcher/restart không gửi trùng email giao key. 3 email theo lifecycle: order confirmation, payment received, delivered keys. **Email là best-effort** — lỗi gửi KHÔNG được rollback đơn (key luôn xem được ở My Orders). Verify SMTP (`transporter.verify()`) trước khi bật. Secret nên ở `.env` (file SQLite importable không nên chứa secret).

---

## 10. Lộ trình triển khai (milestone theo thứ tự)

1. **M1 — Schema & migration:** viết `schema.ts` mới (mục 4), `drizzle-kit generate/migrate`, script backfill, seed `settings`. *(không phá đọc cũ)*
2. **M2 — Auth & session:** `auth/password.ts`, `auth/session.ts`, macro `requireAuth/requireAdmin`, routes register/login/logout/me, admin-from-env, CORS+CSRF, **fix IDOR**.
3. **M3 — Catalog + admin products CRUD + kho key:** routes + suy stock từ `product_keys`; UI admin products + textarea dán key.
4. **M4 — Rate + HD wallet:** `rate.ts` (Kraken/Coinbase, cache, lock), `hd.ts` (@scure, detect prefix, derive, hiện địa chỉ index 0), settings xpub.
5. **M5 — Checkout + watcher:** `/api/checkout` (reserve key, lock rate, derive address, QR), watcher loop (BlockCypher+litecoinspace, idempotent paid+deliver), restart-recovery, expire.
6. **M6 — Frontend khách:** api client env-based, Auth/Cart context, trang shop/product (SEO+JSON-LD), checkout LTC (QR+poll+countdown), My Orders + key.
7. **M7 — Admin dashboard doanh thu + settings:** stats/revenue chart, settings UI (xpub/confirmations/window/SMTP).
8. **M8 — SEO & polish:** sitemap, robots, SEO component, CWV, OG images.
9. **M9 — Email (tùy chọn):** EmailService + templates + verify-before-enable.
10. **M10 — Kiểm thử & hardening:** test luồng vàng + edge (underpaid/overpaid/expired/restart), chạy app thật trên trình duyệt.

---

## 11. Dependency mới (dự kiến)

- Backend: `@scure/bip32`, `@scure/base`, `@noble/hashes`, `@oslojs/encoding` *(đã có)*, `@oslojs/crypto`; tùy chọn `resend` và/hoặc `nodemailer` (optional/lazy). `Bun.password` built-in (không cần lib hash).
- Frontend: `@astrojs/sitemap`, một server adapter (vd `@astrojs/node` standalone — **cần xác nhận chạy ổn trên Bun**, câu hỏi mở #3), `qrcode` (hoặc render QR từ URI).

---

## 12b. Quyết định cuối (đã chốt 2026-06-02)

1. **Bắt buộc đăng nhập mới mua** (không guest checkout) → `orders.userId` NOT NULL, bỏ ý tưởng accessToken.
2. **Product page = SSR** (`prerender=false`) → không cần `getStaticPaths`/rebuild; SEO meta + JSON-LD render server-side.
3. **Deploy = Docker** → adapter `@astrojs/node` standalone; SQLite file qua volume.
4. **Confirmations = 2** cho mọi đơn.
5. **Giá USD = nhập tay mới** cho seed (giá VND cũ bỏ).

## 12. Câu hỏi còn mở (đã giải quyết ở 12b)

1. **Guest checkout:** Cho phép mua **không cần tài khoản** (đơn `userId=null`, cần token bí mật để tra cứu) hay **bắt buộc đăng nhập mới mua**? (Khuyến nghị: bắt buộc đăng nhập — đơn giản & an toàn IDOR hơn.)
2. **Sản phẩm mới & SEO:** Product page nên **static (getStaticPaths, cần rebuild khi thêm SP)** hay **server-render** (xuất hiện ngay nhưng yếu SEO/perf hơn)? (Khuyến nghị: static + trigger rebuild khi admin đổi kho.)
3. **Server adapter cho Astro:** Xác nhận deploy mục tiêu (Bun standalone? Node? container?) để chọn adapter cho route động.
4. **Confirmations:** mặc định **2** (~5 phút) cho mọi đơn, hay nâng theo giá trị đơn (4–6 cho đơn lớn)?
5. **Số dư cũ:** seed sản phẩm hiện tại đang VND — backfill `price_usd` bằng tỷ giá cố định nào, hay nhập tay giá USD mới?

---

### Phụ lục — Ghi chú kiểm chứng đối kháng (verify "partly-wrong")
Các điểm đã sửa và đưa vào plan: (a) BlockCypher batch = **dấu `;`** không phải `,`; (b) rate limit free ~100–200/hr **dao động** → dùng token + backoff; (c) **Blockchair keyless không đáng tin** (HTTP 430); (d) `expectedLitoshi = Math.round((usd/rate)*1e8)` (công thức cũ `round(x,8)*1e8` sai cú pháp JS + lệch float); (e) `zpub` là BIP84 **chung**, pin theo ví thật; (f) đã **live-verify** field BlockCypher + litecoinspace ngày 2026-06-01 — đúng. Web search trong vài sub-agent bị nhiễu/giả mạo (prompt-injection) nên các con số rate-limit cần re-confirm tại nguồn chính trước khi go-live.

---

## 13. TIẾN ĐỘ TRIỂN KHAI (cập nhật 2026-06-03)

**✅ Backend hoàn chỉnh & đã test (M1–M5):**
- **M1 Schema/DB**: 7 bảng, 10 sản phẩm USD, 210 key kho thật. Stock suy từ product_keys.
- **M2 Auth**: argon2id + opaque session (SHA-256 token, cookie HttpOnly), register/login/logout/me, macro requireAuth/requireAdmin, admin từ .env, CORS+CSRF, IDOR cũ loại bỏ.
- **M3 Admin CRUD + kho key**: products CRUD (soft-delete), upload key bulk dedup, gating 401/403/200.
- **M4 Rate + HD wallet**: `lib/hd.ts` (@scure, derive Ltub/Mtub/zpub — 19/19 test pass), `lib/rate.ts` (Kraken/Coinbase + cache + lock, test live), admin settings (validate xpub, mask secrets).
- **M5 Checkout + watcher**: checkout (login bắt buộc, reserve key atomic, lock rate, derive địa chỉ, QR), orders IDOR-safe, status polling, watcher (poll explorer + idempotent paid+deliver + expire + restart-recovery). paymentDecision 7/7 nhánh pass; markPaidAndDeliver idempotent (không double-deliver) verified; explorer live OK.

**⏳ CẦN BẠN VERIFY TRÊN TRÌNH DUYỆT (M6–M10 — frontend & tích hợp):**
- M6 frontend SSR: đã xong adapter @astrojs/node + sitemap + `src/lib/api.ts` (env-based, bỏ hardcode localhost). CÒN: viết lại CartContext (price→priceUsd USD), AuthContext, trang login/register, checkout LTC (QR+poll+countdown), my-orders+key, đồng bộ component cũ. **Phải xem trình duyệt.**
- M7 admin dashboard (doanh thu chart + settings UI), M8 SEO/JSON-LD, M9 email, M10 Docker + test e2e.

**⚠️ TRƯỚC KHI CHẠY THẬT:**
1. Dán **xpub Litecoin THẬT** của bạn vào admin settings (hiện đang là zpub TEST). Đối chiếu địa chỉ index-0 hiển thị với ví thật.
2. Đăng ký BlockCypher free token (tùy chọn, tăng rate limit) → settings `blockcypher_token`.
3. Đổi `ADMIN_PASSWORD` trong `backend/.env` (hiện `admin12345`).
4. Backend chạy: `cd backend && bun src/index.ts` (port 3000). Frontend: `cd frontend && bun dev` (port 4321).
