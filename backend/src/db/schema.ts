import { relations, sql } from "drizzle-orm";
import {
  customType,
  index,
  integer,
  primaryKey,
  real,
  sqliteTable,
  text,
  uniqueIndex,
} from "drizzle-orm/sqlite-core";
import { decrypt, encrypt } from "../lib/encryption.ts";

const encryptedText = customType<{ data: string; driverData: string }>({
  dataType() {
    return "text";
  },
  toDriver(value: string): string {
    return encrypt(value);
  },
  fromDriver(value: string): string {
    return decrypt(value);
  },
});

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
    email: text("email").notNull(),
    passwordHash: text("password_hash").notNull(),
    role: text("role").$type<"customer" | "admin">().default("customer").notNull(),
    status: text("status").$type<"active" | "banned">().default("active").notNull(),
    // TOTP 2FA. Secret stored AES-256-GCM-encrypted via the encryptedText
    // custom type so a DB leak doesn't immediately yield live authenticator
    // seeds for every admin. lastTotpCounter holds the most recent matched
    // RFC-6238 step to block 60-90s replay; new rows start at -1 so the
    // first verification always succeeds. totpBackupCodes is a JSON array
    // of "saltHex:hashHex" (scrypt) entries; NULL when none enrolled.
    totpSecret: encryptedText("totp_secret"),
    totpEnabled: integer("totp_enabled", { mode: "boolean" }).notNull().default(false),
    lastTotpCounter: integer("last_totp_counter").notNull().default(-1),
    totpBackupCodes: text("totp_backup_codes"),
    createdAt: integer("created_at", { mode: "timestamp_ms" })
      .notNull()
      .default(sql`(unixepoch() * 1000)`),
  },
  (t) => ({ emailUnique: uniqueIndex("users_email_unique").on(t.email) }),
);

/* ──────────────────────────── coupons ──────────────────────────── */
export const coupons = sqliteTable(
  "coupons",
  {
    id: text("id").primaryKey(),
    code: text("code").notNull(), // case-insensitive match at app layer
    type: text("type").$type<"percent" | "fixed">().notNull(),
    value: real("value").notNull(), // percent (0-100) or fixed USD
    maxUses: integer("max_uses"), // null = unlimited
    usedCount: integer("used_count").notNull().default(0),
    minOrderUsd: real("min_order_usd").notNull().default(0),
    active: integer("active", { mode: "boolean" }).notNull().default(true),
    expiresAt: integer("expires_at", { mode: "timestamp_ms" }),
    createdAt: integer("created_at", { mode: "timestamp_ms" })
      .notNull()
      .default(sql`(unixepoch() * 1000)`),
  },
  (t) => ({ codeUnique: uniqueIndex("coupons_code_unique").on(t.code) }),
);

/* ──────────────────────────── sessions ─────────────────────────── */
export const sessions = sqliteTable(
  "sessions",
  {
    token: text("token").primaryKey(),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    expiresAt: integer("expires_at", { mode: "timestamp_ms" }).notNull(),
    createdAt: integer("created_at", { mode: "timestamp_ms" })
      .notNull()
      .default(sql`(unixepoch() * 1000)`),
    // Idle timeout tracking. Updated on each validateSession() call so a stolen
    // cookie that is never used drops out faster than the absolute expiresAt.
    // Migration 0005 backfills existing rows from createdAt.
    lastSeenAt: integer("last_seen_at", { mode: "timestamp_ms" })
      .notNull()
      .default(sql`(unixepoch() * 1000)`),
  },
  (t) => ({
    userIdx: index("sessions_user_idx").on(t.userId),
    expiryIdx: index("sessions_expiry_idx").on(t.expiresAt),
    lastSeenIdx: index("sessions_last_seen_idx").on(t.lastSeenAt),
  }),
);

/* ──────────────────────────── categories ───────────────────────── */
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
    createdAt: integer("created_at", { mode: "timestamp_ms" })
      .notNull()
      .default(sql`(unixepoch() * 1000)`),
  },
  (t) => ({
    slugUnique: uniqueIndex("categories_slug_unique").on(t.slug),
    parentIdx: index("categories_parent_idx").on(t.parentId),
  }),
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
    category: text("category").notNull(),
    categoryId: text("category_id"),
    compareAtPrice: real("compare_at_price"),
    deliverables: text("deliverables")
      .$type<"serials" | "service" | "dynamic">()
      .notNull()
      .default("serials"),
    active: integer("active", { mode: "boolean" }).notNull().default(true),
    sold: integer("sold").notNull().default(0),
    createdAt: integer("created_at", { mode: "timestamp_ms" })
      .notNull()
      .default(sql`(unixepoch() * 1000)`),
  },
  (t) => ({
    slugUnique: uniqueIndex("products_slug_unique").on(t.slug),
    categoryIdx: index("products_category_idx").on(t.category),
    categoryIdIdx: index("products_category_id_idx").on(t.categoryId),
    activeIdx: index("products_active_idx").on(t.active),
  }),
);

/* ──────────────────────── product_variants ─────────────────────── */
export const productVariants = sqliteTable(
  "product_variants",
  {
    id: text("id").primaryKey(),
    productId: text("product_id")
      .notNull()
      .references(() => products.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    priceUsd: real("price_usd").notNull().default(0),
    compareAtPrice: real("compare_at_price"),
    createdAt: integer("created_at", { mode: "timestamp_ms" })
      .notNull()
      .default(sql`(unixepoch() * 1000)`),
  },
  (t) => ({
    productIdx: index("product_variants_product_idx").on(t.productId),
  }),
);

/* ───────────────────── product_keys (REAL inventory) ────────────── */
export const productKeys = sqliteTable(
  "product_keys",
  {
    id: text("id").primaryKey(),
    productId: text("product_id")
      .notNull()
      .references(() => products.id, { onDelete: "cascade" }),
    variantId: text("variant_id").references(() => productVariants.id, { onDelete: "cascade" }),
    code: encryptedText("code").notNull(),
    status: text("status")
      .$type<"available" | "reserved" | "delivered">()
      .notNull()
      .default("available"),
    keyType: text("key_type")
      .$type<"code" | "account" | "file" | "instructions">()
      .notNull()
      .default("code"),
    orderId: text("order_id").references(() => orders.id, { onDelete: "set null" }),
    reservedAt: integer("reserved_at", { mode: "timestamp_ms" }),
    deliveredAt: integer("delivered_at", { mode: "timestamp_ms" }),
    createdAt: integer("created_at", { mode: "timestamp_ms" })
      .notNull()
      .default(sql`(unixepoch() * 1000)`),
  },
  (t) => ({
    productStatusIdx: index("product_keys_product_status_idx").on(t.productId, t.status),
    orderIdx: index("product_keys_order_idx").on(t.orderId),
    productCodeUnique: uniqueIndex("product_keys_product_code_unique").on(t.productId, t.code),
  }),
);

/* ───────────────────────────── orders ──────────────────────────── */
export const orders = sqliteTable(
  "orders",
  {
    id: text("id").primaryKey(),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "restrict" }),
    email: text("email").notNull(),
    status: text("status")
      .$type<
        | "pending"
        | "awaiting_payment"
        | "underpaid"
        | "paid"
        | "completed"
        | "expired"
        | "cancelled"
      >()
      .notNull()
      .default("pending"),
    totalUsd: real("total_usd").notNull(),
    ltcRate: real("ltc_rate").notNull(),
    rateSource: text("rate_source"),
    ltcAmount: text("ltc_amount").notNull(),
    expectedLitoshi: integer("expected_litoshi").notNull(),
    addressIndex: integer("address_index").notNull(),
    ltcAddress: text("ltc_address").notNull(),
    receivedLitoshi: integer("received_litoshi").notNull().default(0),
    confirmations: integer("confirmations").notNull().default(0),
    paidTxId: text("paid_tx_id"),
    createdAt: integer("created_at", { mode: "timestamp_ms" })
      .notNull()
      .default(sql`(unixepoch() * 1000)`),
    paidAt: integer("paid_at", { mode: "timestamp_ms" }),
    deliveredAt: integer("delivered_at", { mode: "timestamp_ms" }),
    expiresAt: integer("expires_at", { mode: "timestamp_ms" }).notNull(),
  },
  (t) => ({
    statusIdx: index("orders_status_idx").on(t.status),
    userIdx: index("orders_user_idx").on(t.userId),
    expiresIdx: index("orders_expires_idx").on(t.expiresAt),
    // Perf: admin orders/stats sort by createdAt desc; customer "my orders"
    // filters by (userId, createdAt). Without these, a 100k-row orders table
    // forces a full scan + filesort on every admin and customer view.
    createdIdx: index("orders_created_idx").on(t.createdAt),
    emailIdx: index("orders_email_idx").on(t.email),
    userCreatedIdx: index("orders_user_created_idx").on(t.userId, t.createdAt),
    ltcAddressUnique: uniqueIndex("orders_ltc_address_unique").on(t.ltcAddress),
    addressIndexUnique: uniqueIndex("orders_address_index_unique").on(t.addressIndex),
  }),
);

/* ─────────────────────────── order_items ───────────────────────── */
export const orderItems = sqliteTable(
  "order_items",
  {
    id: text("id").primaryKey(),
    orderId: text("order_id")
      .notNull()
      .references(() => orders.id, { onDelete: "cascade" }),
    productId: text("product_id")
      .notNull()
      .references(() => products.id, { onDelete: "restrict" }),
    name: text("name").notNull(),
    priceUsd: real("price_usd").notNull(),
    quantity: integer("quantity").notNull(),
  },
  (t) => ({
    orderIdx: index("order_items_order_idx").on(t.orderId),
    productIdx: index("order_items_product_idx").on(t.productId),
  }),
);

/* ───────────────────────────── settings ────────────────────────── */
export const settings = sqliteTable("settings", {
  key: text("key").primaryKey(),
  value: encryptedText("value"),
  updatedAt: integer("updated_at", { mode: "timestamp_ms" })
    .notNull()
    .default(sql`(unixepoch() * 1000)`),
});

/* ───────────────────────────── reviews ─────────────────────────── */
export const reviews = sqliteTable(
  "reviews",
  {
    id: text("id").primaryKey(),
    productId: text("product_id")
      .notNull()
      .references(() => products.id, { onDelete: "cascade" }),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    email: text("email").notNull(),
    rating: integer("rating").notNull(),
    body: text("body").notNull().default(""),
    hidden: integer("hidden", { mode: "boolean" }).notNull().default(false),
    createdAt: integer("created_at", { mode: "timestamp_ms" })
      .notNull()
      .default(sql`(unixepoch() * 1000)`),
  },
  (t) => ({
    productIdx: index("reviews_product_idx").on(t.productId),
    userProductUnique: uniqueIndex("reviews_user_product_unique").on(t.userId, t.productId),
  }),
);

/* ───────────────────────────── tickets ─────────────────────────── */
export const tickets = sqliteTable(
  "tickets",
  {
    id: text("id").primaryKey(),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    email: text("email").notNull(),
    orderId: text("order_id").references(() => orders.id, { onDelete: "set null" }),
    subject: text("subject").notNull(),
    status: text("status").$type<"open" | "closed">().notNull().default("open"),
    createdAt: integer("created_at", { mode: "timestamp_ms" })
      .notNull()
      .default(sql`(unixepoch() * 1000)`),
    updatedAt: integer("updated_at", { mode: "timestamp_ms" })
      .notNull()
      .default(sql`(unixepoch() * 1000)`),
  },
  (t) => ({
    userIdx: index("tickets_user_idx").on(t.userId),
    statusIdx: index("tickets_status_idx").on(t.status),
  }),
);

export const ticketMessages = sqliteTable(
  "ticket_messages",
  {
    id: text("id").primaryKey(),
    ticketId: text("ticket_id")
      .notNull()
      .references(() => tickets.id, { onDelete: "cascade" }),
    fromAdmin: integer("from_admin", { mode: "boolean" }).notNull().default(false),
    body: text("body").notNull(),
    createdAt: integer("created_at", { mode: "timestamp_ms" })
      .notNull()
      .default(sql`(unixepoch() * 1000)`),
  },
  (t) => ({ ticketIdx: index("ticket_messages_ticket_idx").on(t.ticketId) }),
);

/* ─────────────────────────── admin_actions ─────────────────────── */
export const adminActions = sqliteTable(
  "admin_actions",
  {
    id: text("id").primaryKey(),
    adminEmail: text("admin_email").notNull(),
    action: text("action").notNull(),
    detail: text("detail"),
    createdAt: integer("created_at", { mode: "timestamp_ms" })
      .notNull()
      .default(sql`(unixepoch() * 1000)`),
  },
  (t) => ({ createdIdx: index("admin_actions_created_idx").on(t.createdAt) }),
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
  variants: many(productVariants),
}));
export const productVariantsRelations = relations(productVariants, ({ one, many }) => ({
  product: one(products, { fields: [productVariants.productId], references: [products.id] }),
  keys: many(productKeys),
}));
export const productKeysRelations = relations(productKeys, ({ one }) => ({
  product: one(products, { fields: [productKeys.productId], references: [products.id] }),
  variant: one(productVariants, {
    fields: [productKeys.variantId],
    references: [productVariants.id],
  }),
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
export const pluginMigrations = sqliteTable(
  "__plugin_migrations",
  {
    pluginId: text("plugin_id").notNull(),
    idx: integer("idx").notNull(),
    appliedAt: integer("applied_at", { mode: "timestamp_ms" }).notNull(),
  },
  (t) => ({
    pk: primaryKey({ columns: [t.pluginId, t.idx] }),
  }),
);
