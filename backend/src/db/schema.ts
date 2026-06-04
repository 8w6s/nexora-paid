import { sqliteTable, text, integer, real, index, uniqueIndex, primaryKey } from "drizzle-orm/sqlite-core";
import { sql, relations } from "drizzle-orm";

/**
 * Nexora digital-goods shop — Drizzle (SQLite/bun:sqlite) schema.
 *
 * Conventions:
 *  - PKs are app-generated text ids (uuid/nanoid) — portable, no AUTOINCREMENT coupling.
 *  - Timestamps: epoch MILLISECONDS as integer({ mode: "timestamp_ms" }) → JS Date in app code.
 *  - Money: priceUsd/totalUsd stored as `real` (USD). Crypto amount stored BOTH as a display
 *    string (ltcAmount, 8dp) AND as integer litoshis (expectedLitoshi) for exact, float-free compare.
 *  - Stock is DERIVED, never stored: stock(product) = count(product_keys WHERE status='available').
 */

/* ───────────────────────────── users ───────────────────────────── */
export const users = sqliteTable(
  "users",
  {
    id: text("id").primaryKey(),
    // Always stored lower-cased + trimmed at the application layer (register/login),
    // so a plain unique index gives case-insensitive uniqueness (drizzle-kit 0.21 has no
    // expression-index support in push).
    email: text("email").notNull(),
    passwordHash: text("password_hash").notNull(),
    role: text("role").$type<"customer" | "admin">().default("customer").notNull(),
    status: text("status").$type<"active" | "banned">().default("active").notNull(),
    createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull().default(sql`(unixepoch() * 1000)`),
  },
  (t) => ({ emailUnique: uniqueIndex("users_email_unique").on(t.email) })
);

/* ──────────────────────────── coupons ──────────────────────────── */
// Discount codes applied at checkout. Discount computed on the USD total before coin conversion.
export const coupons = sqliteTable(
  "coupons",
  {
    id: text("id").primaryKey(),
    code: text("code").notNull(),                          // case-insensitive match at app layer
    type: text("type").$type<"percent" | "fixed">().notNull(),
    value: real("value").notNull(),                        // percent (0-100) or fixed USD
    maxUses: integer("max_uses"),                          // null = unlimited
    usedCount: integer("used_count").notNull().default(0),
    minOrderUsd: real("min_order_usd").notNull().default(0),
    active: integer("active", { mode: "boolean" }).notNull().default(true),
    expiresAt: integer("expires_at", { mode: "timestamp_ms" }),
    createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull().default(sql`(unixepoch() * 1000)`),
  },
  (t) => ({ codeUnique: uniqueIndex("coupons_code_unique").on(t.code) })
);

/* ──────────────────────────── sessions ─────────────────────────── */
// Cookie value === sessions.token. We store SHA-256(rawToken) here; the cookie carries the raw token.
export const sessions = sqliteTable(
  "sessions",
  {
    token: text("token").primaryKey(),
    userId: text("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
    expiresAt: integer("expires_at", { mode: "timestamp_ms" }).notNull(),
    createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull().default(sql`(unixepoch() * 1000)`),
  },
  (t) => ({
    userIdx: index("sessions_user_idx").on(t.userId),
    expiryIdx: index("sessions_expiry_idx").on(t.expiresAt),
  })
);

/* ──────────────────────────── categories ───────────────────────── */
// Hierarchical product categories (up to 4 levels). parentId is a self-reference
// for the tree; null = top-level. Slug is unique across ALL categories (flat
// URL space). sortOrder gives admins explicit ordering within a parent.
export const categories = sqliteTable(
  "categories",
  {
    id: text("id").primaryKey(),
    parentId: text("parent_id"),
    name: text("name").notNull(),
    slug: text("slug").notNull(),
    description: text("description").notNull().default(""),
    image: text("image").notNull().default(""),
    sortOrder: integer("sort_order").notNull().default(0),
    createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull().default(sql`(unixepoch() * 1000)`),
  },
  (t) => ({
    slugUnique: uniqueIndex("categories_slug_unique").on(t.slug),
    parentIdx: index("categories_parent_idx").on(t.parentId),
  })
);

/* ──────────────────────────── products ─────────────────────────── */
export const products = sqliteTable(
  "products",
  {
    id: text("id").primaryKey(),
    slug: text("slug").notNull(),
    name: text("name").notNull(),
    description: text("description").notNull(),
    priceUsd: real("price_usd").notNull().default(0),
    image: text("image").notNull(),
    // Legacy free-text category. Kept for backwards-compat; new code reads categoryId.
    category: text("category").notNull(),
    // Optional FK to the categories table (preferred going forward). Nullable so
    // pre-migration rows don't break and so admins can keep using the string field
    // until they finish organising the tree.
    categoryId: text("category_id"),
    // Delivery model: serials = auto-deliver from product_keys (current behavior).
    // service = manual / instructions only. dynamic = fetch from webhook (groundwork).
    deliverables: text("deliverables").$type<"serials" | "service" | "dynamic">().notNull().default("serials"),
    active: integer("active", { mode: "boolean" }).notNull().default(true),
    sold: integer("sold").notNull().default(0),
    createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull().default(sql`(unixepoch() * 1000)`),
  },
  (t) => ({
    slugUnique: uniqueIndex("products_slug_unique").on(t.slug),
    categoryIdx: index("products_category_idx").on(t.category),
    categoryIdIdx: index("products_category_id_idx").on(t.categoryId),
    activeIdx: index("products_active_idx").on(t.active),
  })
);

/* ───────────────────── product_keys (REAL inventory) ────────────── */
export const productKeys = sqliteTable(
  "product_keys",
  {
    id: text("id").primaryKey(),
    productId: text("product_id").notNull().references(() => products.id, { onDelete: "cascade" }),
    code: text("code").notNull(),
    status: text("status").$type<"available" | "reserved" | "delivered">().notNull().default("available"),
    orderId: text("order_id").references(() => orders.id, { onDelete: "set null" }),
    reservedAt: integer("reserved_at", { mode: "timestamp_ms" }),
    deliveredAt: integer("delivered_at", { mode: "timestamp_ms" }),
    createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull().default(sql`(unixepoch() * 1000)`),
  },
  (t) => ({
    productStatusIdx: index("product_keys_product_status_idx").on(t.productId, t.status),
    orderIdx: index("product_keys_order_idx").on(t.orderId),
    productCodeUnique: uniqueIndex("product_keys_product_code_unique").on(t.productId, t.code),
  })
);

/* ───────────────────────────── orders ──────────────────────────── */
export const orders = sqliteTable(
  "orders",
  {
    id: text("id").primaryKey(),
    // Login required to purchase → userId NOT NULL (no guest checkout).
    userId: text("user_id").notNull().references(() => users.id, { onDelete: "restrict" }),
    email: text("email").notNull(),

    status: text("status")
      .$type<"pending" | "awaiting_payment" | "underpaid" | "paid" | "completed" | "expired" | "cancelled">()
      .notNull()
      .default("pending"),

    // ── Pricing / rate lock (frozen at checkout) ──
    totalUsd: real("total_usd").notNull(),
    ltcRate: real("ltc_rate").notNull(),                       // locked USD-per-LTC
    rateSource: text("rate_source"),
    ltcAmount: text("ltc_amount").notNull(),                   // expected LTC, 8dp string (display)
    expectedLitoshi: integer("expected_litoshi").notNull(),    // integer target (1 LTC = 1e8)

    // ── HD wallet derived receive address (watch-only) ──
    addressIndex: integer("address_index").notNull(),
    ltcAddress: text("ltc_address").notNull(),

    // ── Settlement state (written by the poller) ──
    receivedLitoshi: integer("received_litoshi").notNull().default(0),
    confirmations: integer("confirmations").notNull().default(0),
    paidTxId: text("paid_tx_id"),

    createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull().default(sql`(unixepoch() * 1000)`),
    paidAt: integer("paid_at", { mode: "timestamp_ms" }),
    deliveredAt: integer("delivered_at", { mode: "timestamp_ms" }),
    expiresAt: integer("expires_at", { mode: "timestamp_ms" }).notNull(),   // payment window end
  },
  (t) => ({
    statusIdx: index("orders_status_idx").on(t.status),
    userIdx: index("orders_user_idx").on(t.userId),
    expiresIdx: index("orders_expires_idx").on(t.expiresAt),
    ltcAddressUnique: uniqueIndex("orders_ltc_address_unique").on(t.ltcAddress),
    addressIndexUnique: uniqueIndex("orders_address_index_unique").on(t.addressIndex),
  })
);

/* ─────────────────────────── order_items ───────────────────────── */
export const orderItems = sqliteTable(
  "order_items",
  {
    id: text("id").primaryKey(),
    orderId: text("order_id").notNull().references(() => orders.id, { onDelete: "cascade" }),
    productId: text("product_id").notNull().references(() => products.id, { onDelete: "restrict" }),
    name: text("name").notNull(),
    priceUsd: real("price_usd").notNull(),
    quantity: integer("quantity").notNull(),
  },
  (t) => ({
    orderIdx: index("order_items_order_idx").on(t.orderId),
    productIdx: index("order_items_product_idx").on(t.productId),
  })
);

/* ───────────────────────────── settings ────────────────────────── */
// Key/value config editable in admin. Secrets prefer .env; DB holds toggles + non-secret config.
export const settings = sqliteTable("settings", {
  key: text("key").primaryKey(),
  value: text("value"),
  updatedAt: integer("updated_at", { mode: "timestamp_ms" }).notNull().default(sql`(unixepoch() * 1000)`),
});

/* ───────────────────────────── reviews ─────────────────────────── */
// Verified-purchase product reviews. Shown immediately; admin can hide abusive ones.
export const reviews = sqliteTable(
  "reviews",
  {
    id: text("id").primaryKey(),
    productId: text("product_id").notNull().references(() => products.id, { onDelete: "cascade" }),
    userId: text("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
    email: text("email").notNull(),                 // snapshot for display ("j***@x.com")
    rating: integer("rating").notNull(),            // 1-5
    body: text("body").notNull().default(""),
    hidden: integer("hidden", { mode: "boolean" }).notNull().default(false),
    createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull().default(sql`(unixepoch() * 1000)`),
  },
  (t) => ({
    productIdx: index("reviews_product_idx").on(t.productId),
    userProductUnique: uniqueIndex("reviews_user_product_unique").on(t.userId, t.productId), // one review per product
  })
);

/* ───────────────────────────── tickets ─────────────────────────── */
export const tickets = sqliteTable(
  "tickets",
  {
    id: text("id").primaryKey(),
    userId: text("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
    email: text("email").notNull(),
    orderId: text("order_id").references(() => orders.id, { onDelete: "set null" }), // optional link
    subject: text("subject").notNull(),
    status: text("status").$type<"open" | "closed">().notNull().default("open"),
    createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull().default(sql`(unixepoch() * 1000)`),
    updatedAt: integer("updated_at", { mode: "timestamp_ms" }).notNull().default(sql`(unixepoch() * 1000)`),
  },
  (t) => ({ userIdx: index("tickets_user_idx").on(t.userId), statusIdx: index("tickets_status_idx").on(t.status) })
);

export const ticketMessages = sqliteTable(
  "ticket_messages",
  {
    id: text("id").primaryKey(),
    ticketId: text("ticket_id").notNull().references(() => tickets.id, { onDelete: "cascade" }),
    fromAdmin: integer("from_admin", { mode: "boolean" }).notNull().default(false),
    body: text("body").notNull(),
    createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull().default(sql`(unixepoch() * 1000)`),
  },
  (t) => ({ ticketIdx: index("ticket_messages_ticket_idx").on(t.ticketId) })
);

/* ─────────────────────────── admin_actions ─────────────────────── */
// Audit log of admin operations.
export const adminActions = sqliteTable(
  "admin_actions",
  {
    id: text("id").primaryKey(),
    adminEmail: text("admin_email").notNull(),
    action: text("action").notNull(),               // e.g. "product.create", "customer.ban"
    detail: text("detail"),
    createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull().default(sql`(unixepoch() * 1000)`),
  },
  (t) => ({ createdIdx: index("admin_actions_created_idx").on(t.createdAt) })
);

/* ───────────────────────── relations ────────────────────────────── */
export const usersRelations = relations(users, ({ many }) => ({
  sessions: many(sessions),
  orders: many(orders),
}));
export const sessionsRelations = relations(sessions, ({ one }) => ({
  user: one(users, { fields: [sessions.userId], references: [users.id] }),
}));
export const productsRelations = relations(products, ({ many }) => ({
  keys: many(productKeys),
  orderItems: many(orderItems),
}));
export const productKeysRelations = relations(productKeys, ({ one }) => ({
  product: one(products, { fields: [productKeys.productId], references: [products.id] }),
  order: one(orders, { fields: [productKeys.orderId], references: [orders.id] }),
}));
export const ordersRelations = relations(orders, ({ one, many }) => ({
  user: one(users, { fields: [orders.userId], references: [users.id] }),
  items: many(orderItems),
  keys: many(productKeys),
}));
export const orderItemsRelations = relations(orderItems, ({ one }) => ({
  order: one(orders, { fields: [orderItems.orderId], references: [orders.id] }),
  product: one(products, { fields: [orderItems.productId], references: [products.id] }),
}));

/* ─────────────────────── plugin_migrations ─────────────────────── */
// Per-plugin migration tracker. Each plugin ships an ordered list of SQL
// statements; we record the index of each successfully applied statement so
// reruns skip already-applied ones. Composite PK ensures one row per
// (plugin, statement index).
export const pluginMigrations = sqliteTable("__plugin_migrations", {
  pluginId: text("plugin_id").notNull(),
  idx: integer("idx").notNull(),
  appliedAt: integer("applied_at", { mode: "timestamp" }).notNull(),
}, (t) => ({
  pk: primaryKey({ columns: [t.pluginId, t.idx] }),
}));
