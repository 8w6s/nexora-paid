# Nexora MVP — Scope chốt (không thừa không thiếu)

> Pinned 2026-06-19. So sánh với SellAuth + Whop. Mọi iteration loop sau bám doc này.
> Triết lý: shop digital-goods crypto **chạy được production cho 1 chủ shop**, không phải SaaS multi-tenant.

## Định nghĩa "đầy đủ"
Một khách lạ có thể: tìm sản phẩm → thêm coupon → thanh toán LTC → nhận key tự động qua email + trang đơn → để review → mở ticket nếu lỗi.
Một admin có thể: CRUD sản phẩm/biến thể/kho key/danh mục/coupon → xem đơn/khách → cấu hình storefront + xpub + email → trả ticket → xuất CSV.

## IN — bắt buộc cho MVP (must)

### Storefront
- [x] Home, category page, product page, search + autocomplete
- [x] Cart (1 hoặc nhiều sản phẩm) + variant selection trên product page
- [x] Checkout LTC: lock rate → derive địa chỉ → QR BIP21 → poll trạng thái
- [ ] **Coupon nhập tại checkout** (schema có rồi — wire UI + apply discount trước quy đổi LTC)
- [x] My orders + redownload key + invoice (HTML print-friendly)
- [x] Reviews (verified-purchase + admin moderate)
- [x] Tickets (open + reply)
- [x] Account (register/login/2FA/forgot/reset)
- [x] Legal pages (terms/privacy/refund — đã static, đủ MVP)

### Admin
- [x] Dashboard (revenue/orders/customers + chart)
- [x] Products CRUD + variants + keys (bulk paste)
- [x] Categories CRUD
- [x] Orders list + detail + manual mark paid + resend keys
- [x] Customers list + ban/unban + view-orders-by-customer
- [x] Coupons CRUD (cần verify UI ↔ backend)
- [x] Tickets inbox + reply
- [x] Reviews moderation (hide/show)
- [x] Settings (storefront identity, payment xpub, email provider, security)
- [x] Bulk activate/delete + CSV export (orders/customers)
- [x] Audit log (admin_actions)
- [x] Multi-admin (super-admin from env, others CRUD-able)
- [x] 2FA cho admin

### Vận hành
- [x] HD wallet LTC (xpub-only) + watcher + idempotent delivery
- [x] Setup wizard `/setup` cho lần boot đầu tiên
- [x] Seed demo
- [x] Docker + Caddy + Cloudflare tunnel mode
- [x] Real email gửi qua Resend / SMTP (1 provider đủ)
- [x] Rate limit + session security + secret encryption

## NICE — đã có nhưng KHÔNG bắt buộc xanh để gọi là MVP
- Abandoned-checkout email recovery
- Push notification multi-channel (Discord/Telegram/webhook) — chỉ giữ email
- Wishlist / featured products / banner hero — bonus UX
- Dark mode toggle
- Flash sale countdown
- Bulk discount tiers (quantity deals)
- Bundle offers

## OUT — KHÔNG đưa vào MVP (cắt khỏi gap-list SellAuth)
| SellAuth/Whop có | Lý do cắt |
|---|---|
| Affiliate program | Tăng độ phức tạp + cần payout flow, để v3 |
| Blog CMS | FAQ/legal đã đủ, blog là marketing tool |
| Theme marketplace + Visual Editor | Dùng 1 theme cố định, đủ cho 1 chủ shop |
| Rich text editor (TipTap/Lexical) | Markdown đã đủ cho mô tả sản phẩm + legal |
| Multi-crypto BTC/ETH/SOL | LTC đủ cho MVP. BTC là V2.9 sau khi LTC stable production |
| Stripe/PayPal/Card processors | Định vị crypto-only, fiat = scope creep |
| Discord role assignment | Niche, để plugin sau |
| Customer balance / store credit | Cần audit + accounting, hoãn |
| Addons / upsells / custom checkout fields | Variants đã giải quyết 80% nhu cầu |
| Tax by country | 1 chủ shop quốc tế bán digital → buyer tự khai, hoãn |
| Teams & permissions | Multi-admin flat đủ cho MVP |
| Checkout Embed / Checkout Link | SaaS feature, không cần |
| Shipping zones | Digital-only, không bao giờ cần |
| Push notifications multi-channel | Email là kênh chuẩn duy nhất MVP |
| Quantity deals / bundle offers | Coupon đủ cho khuyến mãi MVP |

## Tiêu chí "MVP done" (acceptance)
1. `bun run dev` → boot, setup wizard, tạo admin, seed → mở `/` thấy 10 sản phẩm.
2. Khách register → mua 1 sản phẩm có variant + coupon → trả LTC testnet → nhận key qua email + trang đơn → review → mở ticket.
3. Admin: CRUD đầy đủ + ban customer + xuất CSV + moderate review + trả ticket + manual mark paid.
4. Real email gửi thành công ít nhất 1 provider (Resend hoặc SMTP).
5. e2e suite (`backend/src/e2e.test.ts`) xanh.
6. Docker compose up → cùng kết quả.

## Delta cần làm (so với hiện trạng commit `089b28c`)
Thứ tự ưu tiên (ngắn → dài):
1. **Coupon checkout integration** — schema có, cần verify route + UI form input + áp dụng giảm giá đúng nơi (USD trước quy đổi LTC).
2. **Variant selection trên product page + cart** — nếu chưa wire.
3. **Real email send** — code mailer + admin Settings test-button.
4. **Customer view-orders-by-customer trong admin** — verify exists.
5. **e2e covers coupon + variant + email path**.
6. **MVP_DONE checklist** — chạy đủ 6 aceptance, fix gì hỏng.

Ngoài 6 mục trên, mọi thứ khác là **out of MVP scope**, không động vào trừ khi sửa lỗi production-blocking.