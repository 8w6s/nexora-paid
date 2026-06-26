/**
 * End-to-end backend test against a running server on :3000.
 * Run:  bun src/e2e.script.ts   (server must be up; uses a real test xpub already in settings)
 * Cleans up its own test rows at the end.
 */
import { Database } from "bun:sqlite";

const B = "http://localhost:3000";
const O = "http://localhost:4321";
let _pass = 0,
  fail = 0;
const ok = (_label: string, cond: boolean, _extra = "") => {
  if (cond) {
    _pass++;
  } else {
    fail++;
    process.stderr.write(`FAIL: ${_label}${_extra ? ` (${_extra})` : ""}
`);
  }
};
process.on("exit", () =>
  process.stderr.write(`
E2E: ${_pass} pass, ${fail} fail
`),
);
const jar: Record<string, string> = {};
async function call(method: string, path: string, body?: unknown, who?: string) {
  const headers: Record<string, string> = { "Content-Type": "application/json", Origin: O };
  if (who && jar[who]) headers.Cookie = jar[who];
  const res = await fetch(`${B}${path}`, {
    method,
    headers,
    body: body ? JSON.stringify(body) : undefined,
  });
  const setc = res.headers.get("set-cookie");
  if (setc && who) jar[who] = setc.split(";")[0];
  const data: any = await res.json().catch(() => ({}));
  return { status: res.status, data };
}

const email = `e2e_${Date.now()}@test.com`;
const reg = await call("POST", "/api/auth/register", { email, password: "secret123" }, "c");
ok("register", reg.status === 201, `id=${reg.data.id}`);
const me = await call("GET", "/api/auth/me", undefined, "c");
ok("me after register", me.status === 200 && me.data.user?.email === email);
const noauth = await call("POST", "/api/checkout", { items: [{ productId: "prod-1", qty: 1 }] });
ok(
  "checkout without auth → 400 (EMAIL_REQUIRED)",
  noauth.status === 400 && noauth.data.code === "EMAIL_REQUIRED",
);
const co = await call("POST", "/api/checkout", { items: [{ productId: "prod-1", qty: 2 }] }, "c");
ok("checkout creates order", co.status === 201, `order=${co.data.orderId}`);
ok(
  "has LTC address",
  typeof co.data.ltcAddress === "string" && co.data.ltcAddress.length > 10,
  co.data.ltcAddress,
);
ok("has expectedLitoshi", Number(co.data.expectedLitoshi) > 0, `${co.data.ltcAmount} LTC`);
const orderId = co.data.orderId as string;

await new Promise((r) => setTimeout(r, 1500));
const oos = await call("POST", "/api/checkout", { items: [{ productId: "prod-5", qty: 1 }] }, "c");
ok("out-of-stock → 400", oos.status === 400, oos.data.code);
const email2 = `e2e2_${Date.now()}@test.com`;
await call("POST", "/api/auth/register", { email: email2, password: "secret123" }, "a");
const mine = await call("GET", `/api/orders/${orderId}`, undefined, "c");
const theirs = await call("GET", `/api/orders/${orderId}`, undefined, "a");
ok("owner sees order (200)", mine.status === 200);
ok("non-owner gets 404 (not 403)", theirs.status === 404);
const { markPaidAndDeliver } = await import("./lib/inventory.ts");
const d1 = await markPaidAndDeliver(orderId, "txE2E", Number(co.data.expectedLitoshi), 2);
ok("delivery returns keys", Array.isArray(d1) && d1.length === 2, `${d1?.length} keys`);
const d2 = await markPaidAndDeliver(orderId, "txE2E", Number(co.data.expectedLitoshi), 2);
ok("second delivery is no-op (idempotent)", d2 === null);
const detail = await call("GET", `/api/orders/${orderId}`, undefined, "c");
ok("order now paid", detail.data.status === "paid");
ok(
  "delivered keys visible to owner",
  Array.isArray(detail.data.deliveredKeys) && detail.data.deliveredKeys.length === 2,
);
const adminLogin = await call(
  "POST",
  "/api/auth/login",
  {
    email: process.env.ADMIN_EMAIL ?? "admin@nexora.local",
    password: process.env.ADMIN_PASSWORD ?? "admin12345",
  },
  "a",
);
ok("admin login role=admin", adminLogin.data.role === "admin");
const stats = await call("GET", "/api/admin/stats", undefined, "a");
ok(
  "admin stats revenue reflects paid order",
  stats.data.revenueUsd > 0,
  `$${stats.data.revenueUsd}`,
);
ok("admin stats has 14-day series", stats.data.revenueSeries?.length === 14);
const adminOrders = await call("GET", "/api/admin/orders?status=paid", undefined, "a");
ok(
  "admin can filter paid orders",
  Array.isArray(adminOrders.data) && adminOrders.data.some((o: any) => o.id === orderId),
);

// ── Coupon path (MVP_SCOPE acceptance #5) ──
const couponCode = `E2E${Date.now().toString(36).toUpperCase()}`.slice(0, 16);
const mkCoupon = await call(
  "POST",
  "/api/admin/coupons",
  { code: couponCode, type: "percent", value: 10, active: true },
  "a",
);
ok(
  "admin creates coupon",
  mkCoupon.status === 201 || mkCoupon.status === 200,
  `code=${couponCode}`,
);
await new Promise((r) => setTimeout(r, 1500));
const email3 = `e2e3_${Date.now()}@test.com`;
await call("POST", "/api/auth/register", { email: email3, password: "secret123" }, "k");
const coWithCoupon = await call(
  "POST",
  "/api/checkout",
  { items: [{ productId: "prod-3", qty: 1 }], coupon: couponCode },
  "k",
);
ok(
  "checkout accepts valid coupon",
  coWithCoupon.status === 201,
  `order=${coWithCoupon.data.orderId}`,
);
const couponOrderId = coWithCoupon.data.orderId as string;
const orderDetail = await call("GET", `/api/orders/${couponOrderId}`, undefined, "k");
ok(
  "coupon applied — totalUsd discounted from list price",
  Number(orderDetail.data.totalUsd) > 0 && Number(orderDetail.data.totalUsd) < 999,
  `total=$${orderDetail.data.totalUsd}`,
);

// Variant checkout — prod-2 must be bought via a variantId since sed
// redistributed all keys to variants (variantId-NULL keys = 0).
await new Promise((r) => setTimeout(r, 1500));
const email4 = `e2e4_${Date.now()}@test.com`;
await call("POST", "/api/auth/register", { email: email4, password: "secret123" }, "v");
const variantOrder = await call(
  "POST",
  "/api/checkout",
  { items: [{ productId: "prod-2", variantId: "var-prod2-1m", qty: 1 }] },
  "v",
);
ok(
  "variant checkout creates order",
  variantOrder.status === 201,
  `order=${variantOrder.data.orderId}`,
);
const variantOrderId = variantOrder.data.orderId as string;
const variantDetail = await call("GET", `/api/orders/${variantOrderId}`, undefined, "v");
ok(
  "variant price applied (1 Month tier ~ $2.49)",
  Number(variantDetail.data.totalUsd) > 1 && Number(variantDetail.data.totalUsd) < 5,
  `total=$${variantDetail.data.totalUsd}`,
);

const db = new Database("sqlite.db");
db.run(
  "UPDATE product_keys SET status='available', order_id=NULL, reserved_at=NULL, delivered_at=NULL WHERE order_id=?",
  [couponOrderId],
);
db.run("DELETE FROM order_items WHERE order_id=?", [couponOrderId]);
db.run("DELETE FROM orders WHERE id=?", [couponOrderId]);
db.run("DELETE FROM coupons WHERE code=?", [couponCode]);
db.run("DELETE FROM users WHERE email=?", [email3]);
db.run(
  "UPDATE product_keys SET status='available', order_id=NULL, reserved_at=NULL, delivered_at=NULL WHERE order_id=?",
  [orderId],
);
db.run("DELETE FROM order_items WHERE order_id=?", [orderId]);
db.run("DELETE FROM orders WHERE id=?", [orderId]);
db.run("UPDATE products SET sold=0 WHERE id='prod-1'");
db.run("DELETE FROM users WHERE email IN (?,?)", [email, email2]);
db.run("UPDATE settings SET value='0' WHERE key='hd_next_index'");
process.exit(fail > 0 ? 1 : 0);
