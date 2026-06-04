# GemVN — Plan nâng cấp V2 ("shop xịn hơn") — BẢN ĐẦY ĐỦ

> Mốc an toàn đã commit (`2836c52`). Tài liệu để **duyệt trước khi code**. Tổng hợp toàn bộ lựa chọn của bạn.

## Tổng quan định hướng
Làm **rộng nhiều tính năng**. 6 nhóm lớn: Quản trị · Mua sắm · Giá/khuyến mãi · Giao hàng · Tin cậy · Đa coin · Vận hành/bảo mật/realtime.

---

## A. Quản trị (Admin) mạnh hơn
- `users` thêm `status`(active|banned), `displayName?`, `lastLoginAt?`, `emailVerified`(bool).
- **Customers tab:** list (email, ngày ĐK, số đơn, tổng chi USD, trạng thái) → bấm xem **đơn + key theo khách**; **ban/unban** + thu hồi session.
- **Admins tab:** thêm/xóa admin (admin .env là super, không xóa). 
- **Audit log** (`admin_actions`): ai làm gì, khi nào.
- **Orders nâng cao:** resend key (email), refund note, tìm/lọc theo email/mã.

## B. Mua sắm
- **Search + filter + sort:** `/api/products?q=&sort=&category=&inStock=` + UI shop.
- **Reviews (verified purchase):** chỉ khách đã mua; **hiện ngay + admin có thể ẩn (report)**; AggregateRating JSON-LD chỉ khi có review thật.
- **Coupon:** `coupons`(code,type %|fixed,value,maxUses,usedCount,minOrderUsd,expiresAt,active). Áp lúc checkout → **giảm trên totalUsd rồi mới quy đổi coin**. Admin Coupons tab.
- **Wishlist + sản phẩm liên quan** (cùng danh mục).

## C. Giá & khuyến mãi
- `compareAtPrice` (giá gốc gạch ngang) + badge "-30%".
- **Biến thể gói** (`product_variants`: name, priceUsd, compareAtPrice) — **mỗi biến thể có kho key RIÊNG** (product_keys gắn variantId). 1 SP nhiều gói 1/3/12 tháng.
- **Giảm theo số lượng** (tiers: từ N cái giảm X%).
- **Flash sale có hạn:** sale window (start/end) + đếm ngược trên trang SP.

## D. Giao hàng (delivery)
- Key kho hỗ trợ **nhiều loại**: `type` = code | account(user:pass) | file(url) | instructions. Hiển thị phù hợp từng loại.
- **My Orders:** xem lại key bất kỳ lúc nào + nút copy + **tải hóa đơn PDF**.
- **Bảo hành/replace:** khách báo lỗi key → admin cấp key thay từ kho; có thời hạn bảo hành (warrantyDays).

## E. Tin cậy / chuyên nghiệp
- **Email thật:** kích hoạt EmailService (bạn nhập Resend/SMTP trong admin). Gửi: verify, xác nhận đơn, giao key, trả lời ticket.
- **Trang nội dung (CMS nhỏ):** `pages` table (slug, title, body markdown) — admin sửa FAQ/Terms/Refund/Contact trực tiếp. SSR + SEO.
- **Ticket hỗ trợ + email:** `tickets`+`ticket_messages`, gắn đơn; admin trả lời; **email báo khi có trả lời** (nếu email bật).

## F. Đa coin (LTC + BTC + ETH)
- Tổng quát hóa: `orders.coin`(LTC|BTC|ETH), `coinAmount`, `coinAddress`, `coinRate`; settings mỗi coin (xpub + required_confirmations + explorer key).
- Checkout: khách **chọn coin** → derive địa chỉ + khóa tỷ giá USD→coin (CoinGecko đa coin) + QR BIP21 từng coin.
- **BTC:** UTXO như LTC (@scure derive, mempool.space) — dễ.
- **ETH:** account-based, derive m/44'/60', watcher poll số dư qua **Etherscan (bạn cấp API key)**, xử lý wei/decimals.

## G. Vận hành / bảo mật / realtime
- **Email verify:** gửi link verify; **khuyến khích, không chặn mua**; badge "chưa xác minh". + Quên mật khẩu qua email.
- **Chống lạm dụng:** rate-limit chặt + **captcha tự làm (proof-of-work nhẹ, không bên thứ 3)** ở đăng ký/checkout + giới hạn đơn pending/IP.
- **Realtime (SSE):** server đẩy sự kiện → toast khi đơn paid (trang khách), alert đơn mới (admin). Dùng Server-Sent Events.
- **Export & backup:** xuất đơn/doanh thu CSV; backup file SQLite định kỳ (script).
- **Dark mode:** công tắc sáng/tối toàn web (CSS vars + localStorage).
- **Trang danh mục riêng:** `/category/[slug]` filter + SEO riêng.
- **Banner/hero + SP nổi bật + bán chạy** trên home.
- *(Đa ngôn ngữ EN/VI: ghi nhận nhưng để cuối/tùy chọn — chưa chọn rõ.)*

---

## H. Nền tảng "clone-and-run" (boilerplate) — LÀM TRƯỚC
> Mục tiêu cuối: người khác clone repo về, khởi chạy là có shop riêng — không sửa code.
- **Feature flags trong Admin (DB):** bảng/settings `feature_*` — gần như TẤT CẢ module toggle được (reviews, coupon, wishlist, ticket, multi-coin, email, dark mode, flash sale, captcha, reviews...). UI Admin → Features tab. Mỗi tính năng đọc flag; tắt → ẩn hoàn toàn (route + UI). Mặc định an toàn để clone là chạy.
- **Setup wizard (`/setup`):** chỉ hiện khi **DB chưa có admin nào**. Dẫn: tạo tài khoản admin → nhập tên shop → (tùy chọn) dán xpub coin → chọn tính năng bật. Xong → tự khóa (`/setup` redirect khi đã có admin). Không cần sửa file.
- **Font Awesome Pro Kit:** nhúng qua **Kit URL** (bạn dán vào settings/`.env` `FA_KIT_URL`); Layout chèn `<script src=kit>`. Icon dùng `fa-duotone`/`fa-regular`. Giữ API `<Icon name=...>` nhưng render `<i class="fa-duotone fa-...">` bên trong (ít sửa code gọi, đổi style tập trung). Fallback nếu chưa có Kit: dùng SVG cũ.
- **Config mặc định + seed an toàn:** `.env.example` đầy đủ + seed demo + tất cả flag có default hợp lý.

## Lộ trình (milestone V2)
- **V2.0 — Nền tảng clone-and-run (LÀM ĐẦU):** feature-flags (settings + helper + Admin Features tab), setup wizard `/setup`, FA Pro Kit icon system, config/seed mặc định. Mọi milestone sau gắn flag từ đầu.
1. **V2.1 Schema mở rộng** — users.status/emailVerified, product_variants (+ key gắn variant), compareAtPrice, coupons, reviews, pages, tickets, admin_actions, orders.coin. Migration + reseed demo.
2. **V2.2 User management** — Customers tab, ban/unban + revoke session, admin xem đơn theo khách.
3. **V2.3 Multi-admin + audit log.**
4. **V2.4 Search/filter/sort** (backend + UI shop) + **trang danh mục** + home banner/featured.
5. **V2.5 Biến thể gói + giá sale/compareAt + flash sale + giảm số lượng.**
6. **V2.6 Coupon** (backend + checkout + admin).
7. **V2.7 Reviews** (verified purchase + report/ẩn).
8. **V2.8 Delivery nâng cao** — loại key đa dạng, hóa đơn PDF, bảo hành/replace.
9. **V2.9 Đa coin** — generalize wallet/watcher, BTC rồi ETH (Etherscan key), chọn coin checkout.
10. **V2.10 Email thật + verify + quên mật khẩu.**
11. **V2.11 Ticket + email thông báo.**
12. **V2.12 CMS trang nội dung** (FAQ/Terms/Refund/Contact).
13. **V2.13 Realtime SSE** (toast paid + alert admin).
14. **V2.14 Bảo mật** — captcha tự làm, rate-limit nâng cao, giới hạn pending/IP.
15. **V2.15 Dark mode + UX polish.**
16. **V2.16 Export CSV + backup script.**
17. **V2.17 Kiểm thử + e2e mở rộng + Docker.**

## Quyết định đã chốt
Variant kho riêng · email verify khuyến-khích-không-chặn · captcha tự-làm · realtime SSE · review hiện-ngay-có-report · ETH dùng Etherscan key (bạn cấp) · ticket cơ-bản+email · trang nội dung CMS-trong-admin · coupon giảm-USD-trước-quy-đổi.

## Còn mở (nhỏ, có thể quyết khi làm tới)
1. Đa ngôn ngữ EN/VI: làm hay bỏ? (đề xuất: để cuối, tùy chọn)
2. Hóa đơn PDF: tạo server-side (thư viện) hay in-trình-duyệt (đơn giản)? (đề xuất: in-trình-duyệt)
3. Wishlist cần đăng nhập (lưu DB) hay localStorage? (đề xuất: localStorage cho gọn)
