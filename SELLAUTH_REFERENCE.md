# 📚 SellAuth – Reference Documentation (Tham khảo đầy đủ)

> Khám phá toàn bộ SellAuth dashboard, chụp ảnh và document để làm reference cho Nexora.
> Screenshots lưu tại: `C:\Users\FUJITSU\Desktop\PROJECTS\nexora-paid\ss\`

---

## 🗂️ Sidebar Navigation (Toàn bộ menu)

### Catalog
- **Products** – Danh sách sản phẩm, tạo/sửa/xóa
- **Addons** – Thêm phụ kiện vào sản phẩm (upsells)
- **Groups** – Nhóm sản phẩm
- **Categories** – Danh mục
- **Coupons** – Mã giảm giá (% or fixed, per-product)
- **Quantity Deals** *(NEW)* – Tự động giảm giá khi mua số lượng lớn (buy-X-get-Y)
- **Bundle Offers** *(NEW)* – Giảm giá tự động khi giỏ hàng có combo sản phẩm nhất định

### Orders
- **Invoices** – Toàn bộ đơn hàng
- **Customers** – Danh sách khách hàng

### Feedbacks
- Khách hàng để lại review sau mua hàng
- Nút "Leave Feedback" trong invoice page & email
- Phản hồi tự động sau 7 ngày (5 stars)

### Tickets
- Hỗ trợ khách hàng qua ticket
- Có thể tắt/bật

### Abandoned Checkouts
- Theo dõi checkout bị bỏ dở
- Gửi email recovery

### Wallets
- **Crypto** – Ví crypto (Bitcoin, Litecoin, Ethereum, Solana)

### Storefront
- **Configure** – Cấu hình toàn bộ storefront
- **Themes** – Quản lý themes (Default, Blue, Pro – free; Glitch, Glow – premium $49.99)
- **Visual Editor** – Kéo thả chỉnh giao diện (cần import theme)
- **Code Editor** – Edit code theme trực tiếp
- **Custom Pages** – Tạo trang tùy chỉnh
- **Blog** – Đăng bài blog
- **Email Templates** – Tùy chỉnh template email HTML
- **Images** – Thư viện ảnh
- **Files** – Downloadable files
- **Push Notifications** – Cấu hình thông báo

### Activity Logs
- Lịch sử hoạt động của shop

### Subscription
- Plan hiện tại (Free → Business)

### Settings
- **Payment Methods** – Cấu hình phương thức thanh toán
- **Team** – Quản lý thành viên team, phân quyền
- **Domains** – Custom domain (Business plan)
- **Import** – Import dữ liệu
- **Blacklist / Whitelist / Fraud Logs** – Anti-fraud

### Account
- **Profile** – Thông tin tài khoản
- **Invites** – Invite bạn bè
- **Developers** – API key, Shop IDs, Checkout Embed, Checkout Link

---

## ⚙️ Configure Storefront Tabs (Chi tiết)

Screenshot: `sellauth_01_identity.png` → `sellauth_12_miscellaneous.png`

### 1. Identity
| Field | Mô tả |
|-------|--------|
| Shop Name | Tên shop hiển thị khắp website & email |
| Subdomain | URL shop (chỉ chứa chữ, số, dấu gạch) |
| Currency | Tiền tệ mặc định |
| Logo | Ảnh header |
| Favicon | Icon tab trình duyệt |
| Background | Ảnh nền website |
| Description | Mô tả shop (tùy theme có hiển thị không) |
| Meta Title | SEO – title trình duyệt |
| Meta Description | SEO – description cho Google |
| Meta Image | Ảnh khi share link lên social media |
| Meta Twitter Card | Small Image / Large Image (Discord/X preview) |

### 2. Socials
| Field | Mô tả |
|-------|--------|
| Discord | Link Discord server |
| YouTube | Link YouTube channel |
| Telegram | Link Telegram |
| TikTok | Link TikTok |
| Instagram | Link Instagram |

### 3. Checkout
| Toggle | Mô tả |
|--------|--------|
| Checkout Color Scheme | System / Light / Dark |
| Allow Customer to Change Color Scheme | Cho phép khách chuyển dark/light |
| Collect Billing Address | Thu thập địa chỉ thanh toán |
| Show Coupon Code Textbox | Hiện ô nhập coupon |
| Show Terms Checkbox | Hiện checkbox đồng ý ToS |
| Pre-check Terms Checkbox | Tích sẵn checkbox ToS |
| Show Newsletter Checkbox | Hiện checkbox đăng ký newsletter |

### 4. Invoices & Tax
| Field/Toggle | Mô tả |
|-------------|--------|
| Enable Tax Calculation | Bật/tắt tính thuế |
| Tax Rate (%) | % thuế áp dụng |
| Tax Rates by Country | Tính thuế theo IP quốc gia |
| Send Invoice PDFs | Đính kèm PDF trong email xác nhận đơn |
| Show Invoice PDF Link | Hiện link tải PDF trên checkout page |
| Invoice PDF Header | **Rich Text Editor** – Header trên PDF invoice |
| Invoice PDF Notes | **Rich Text Editor** – Ghi chú bên dưới items |
| Invoice PDF Footer | **Rich Text Editor** – Footer dưới cùng PDF |

### 5. Feedbacks
| Toggle | Mô tả |
|--------|--------|
| Enable Automatic Feedbacks | Tự động tạo feedback 5 sao sau 7 ngày |
| Delete Automatic Feedbacks | Xóa toàn bộ feedback tự động |

### 6. Affiliate Program
| Field/Toggle | Mô tả |
|-------------|--------|
| Enable Affiliate Program | Bật chương trình affiliate |
| Make Affiliate Program Public | Mọi khách đều có thể tham gia |
| Allow Customers to Edit Affiliate Code | Cho phép tùy chỉnh code affiliate |
| Affiliate Percentage | % hoa hồng (5/10/15/20/25/50%) |

### 7. Tickets
| Toggle | Mô tả |
|--------|--------|
| Enable Tickets | Bật/tắt hỗ trợ ticket |

### 8. Legal Pages
| Page | Mô tả |
|------|--------|
| Terms of Service | **Rich Text Editor** |
| Privacy Policy | **Rich Text Editor** |
| Refund Policy | **Rich Text Editor** |

### 9. Integrations
| Integration | Mô tả |
|------------|--------|
| Google Analytics | gtag measurement ID |
| Crisp | Live chat widget |
| Tawk.to | Free live chat |
| Trustpilot | AFS BCC email cho review automation |

### 10. E-mail Server
- SMTP tùy chỉnh (Business plan)
- Dùng domain riêng, tránh spam

### 11. Discord Integration
| Field | Mô tả |
|-------|--------|
| Discord Client ID | từ discord.com/developers |
| Discord Client Secret | từ discord.com/developers |
| Discord Bot Token | Từ Bot tab |
| Invite Bot | Mời bot vào server → assign role cho buyer |

### 12. Miscellaneous
| Toggle/Action | Mô tả |
|-------------|--------|
| Redirect mysellauth.com → Custom Domain | SEO redirect |
| Hide Out of Stock Products | Ẩn hàng hết |
| Refund Out of Stock Items to Customer Balance | Hoàn tiền vào balance nếu hết hàng |
| Enable Maintenance Mode | Bật trang bảo trì (có password) |
| Maintenance Password | Password vào shop khi bảo trì |
| Webhook Secret | Xác thực webhook Dynamic Delivery & HTTP notifications |
| Reset Statistics | Reset "Products Sold" và "Total Customers" |

---

## 🛒 Payment Methods (Toàn bộ)

Screenshot: `sellauth_15_payment_methods.png`

### Card Processors
Stripe, Square, SumUp, Mollie, Skrill Business, Authorize.Net, Revolut Business, NMI, Overpay, MONEI, Razorpay, Mercado Pago, VenPayr, OVGC Payments, Adyen, Amazon Payment Services

### Platforms
Lemon Squeezy, Pandabase, Whop, Shopify

### Wallets & Transfers
PayPal, PayPal (F&F), Cash App, Venmo (F&F), Rewarble, MisticPay - PIX

### Cryptocurrency
Bitcoin, Litecoin, Ethereum, Solana

### Other
Customer Balance, Manual Payment Method

---

## 📦 Product Editor (Create Product)

Screenshot: `sellauth_26_product_editor.png`, `sellauth_27_product_editor_full.png`

### Product Templates
- Serial Keys / License Keys
- Accounts
- Discord Nitro Gifts
- Game Top-Up / Gift Cards
- Subscriptions / Memberships
- Cheats / Software
- Digital Downloads
- Service
- Dynamic Delivery (webhook)
- Start from scratch

### Product Editor Tabs
| Tab | Nội dung |
|-----|----------|
| General | Name, URL Path, **Description (Rich Text)**, Category, Image, **Instructions (Rich Text)**, Deliverables Type (Serials/Service/Dynamic/Files/Physical), Description Tabs |
| Pricing & Stock | Giá, stock, variants |
| Custom Fields | Fields tùy chỉnh trong checkout |
| Addons & Upsells | Thêm addon |
| SEO | Meta fields |
| Visibility | Hiển thị/ẩn sản phẩm |
| Financials | Thông tin tài chính |
| Statistics | Thống kê |
| Discord | Assign role Discord sau mua |
| Developer | Webhook, API |
| Miscellaneous | Cài đặt khác |

---

## 📊 Dashboard
- Revenue (Total, change %)
- Orders (count, change %)
- Customers (unique, change %)
- Avg. Order Value
- Revenue chart (line chart theo ngày)
- Orders chart
- Latest Completed Orders (table)
- Best Selling Products (ranking)
- Top Spenders (ranking)
- Most Used Methods (ranking)
- Date range filter: Today / 7 days / 30 days / Custom

---

## 🔔 Push Notifications (per event)

Mỗi event có thể cấu hình thông báo qua: **Email, Discord, Telegram, Webhook**

Events:
- Order Created
- Order Completed
- Manual Order Marked As Paid
- Invoice Items Out of Stock
- Product Variant Out of Stock
- Feedback Created / Updated / Dispute Accepted / Rejected
- Ticket Created / Ticket Message
- Shop Subscription Ending
- Shop Error
- Product Restocked

---

## 📧 Email Templates (Edit HTML)
- Base Layout
- Invoice Created
- Invoice Processed
- Invoice Replacement Issued
- Feedback Reply
- Feedback Coupon Reward
- Feedback Dispute Accepted
- Customer Login Code
- Ticket Closed
- Ticket Message
- Abandoned Checkout Recovery

---

## 🎨 Themes
- **Default** – Free
- **Blue** – Free
- **Pro** – Free
- **GLITCH** – $49.99 (Unique, Animated, Visual Editor)
- **Glow** – $49.99 (Modern, Visual Editor)

---

## 🔑 Rich Text Editor (Word-like Editor)

Được dùng ở nhiều nơi trong SellAuth:
- Product Description
- Product Instructions
- Description Tabs (trong product)
- Invoice PDF Header / Notes / Footer
- Legal Pages (ToS, Privacy, Refund)

Toolbar bao gồm:
- Font style: Normal, H1, H2, H3
- Bold, Italic, Underline, Strikethrough
- Bullet list, Numbered list
- Link
- Code block
- Text alignment

---

## ❌ Tính năng cần Business Plan
- Custom Domain
- SMTP Server tùy chỉnh
- Files delivery type (BETA)
- Visual Editor (cần import theme)

---

## 💡 Features Nexora Cần Implement (Gap Analysis)

| Feature SellAuth | Trạng thái Nexora |
|-----------------|------------------|
| Rich Text Editor (product description) | ⚠️ Thiếu |
| Rich Text Editor (legal pages) | ⚠️ Thiếu |
| Rich Text Editor (invoice PDF) | ⚠️ Thiếu |
| Quantity Deals (bulk discount) | ❌ Chưa có |
| Bundle Offers (combo discount) | ❌ Chưa có |
| Affiliate Program | ❌ Chưa có |
| Blog | ❌ Chưa có |
| Abandoned Checkout tracking + email | ❌ Chưa có |
| Push Notification settings | ⚠️ Có partial |
| Email Templates editor | ❌ Chưa có |
| Product Description Tabs | ❌ Chưa có |
| Custom Product Fields | ❌ Chưa có |
| Addons & Upsells | ❌ Chưa có |
| Blacklist / Whitelist | ❌ Chưa có |
| Customer Balance payment | ❌ Chưa có |
| Shopify / Platform integrations | ❌ Chưa có |
| Customer Panel (login/feedback/affiliate dashboard) | ❌ Chưa có |
| Teams & permissions | ❌ Chưa có |
| Checkout Embed & Checkout Link | ❌ Chưa có |
| Tax calculation by country | ❌ Chưa có |
| Discord role assignment after purchase | ❌ Chưa có |
| Theme system (Visual + Code editor) | ❌ Chưa có |
| Invoices PDF with rich text | ❌ Chưa có |
| Products tab "Addons" | ❌ Chưa có |
| Products tab "Groups" | ❌ Chưa có |
| Shipping Zones | ❌ Chưa có |
