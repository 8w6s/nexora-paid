import { Elysia, t } from "elysia";
import { randomUUID } from "crypto";
import { and, eq, desc, inArray } from "drizzle-orm";
import { db } from "../db/connection.ts";
import { reviews, orders, orderItems, products } from "../db/schema.ts";
import { validateSession, SESSION_COOKIE, type SessionUser } from "../lib/auth.ts";
import { isEnabled } from "../lib/features.ts";

// The storefront route uses :idOrSlug, so reviews must resolve either to the real product id.
async function resolveProductId(idOrSlug: string): Promise<string | null> {
  const bySlug = (await db.select({ id: products.id }).from(products).where(eq(products.slug, idOrSlug)))[0];
  if (bySlug) return bySlug.id;
  const byId = (await db.select({ id: products.id }).from(products).where(eq(products.id, idOrSlug)))[0];
  return byId?.id ?? null;
}

// Mask an email for public display: "john@x.com" -> "jo***@x.com"
function maskEmail(email: string): string {
  const [u, d] = email.split("@");
  if (!u || !d) return "anonymous";
  return `${u.slice(0, 2)}${"*".repeat(Math.max(1, u.length - 2))}@${d}`;
}

// Has this user actually bought (paid/completed) the product?
async function hasPurchased(userId: string, productId: string): Promise<boolean> {
  const userOrders = await db.select().from(orders).where(eq(orders.userId, userId));
  const paidIds = userOrders.filter((o) => o.status === "paid" || o.status === "completed").map((o) => o.id);
  if (paidIds.length === 0) return false;
  const items = await db
    .select({ id: orderItems.id })
    .from(orderItems)
    .where(and(inArray(orderItems.orderId, paidIds), eq(orderItems.productId, productId)));
  return items.length > 0;
}

export const reviewRoutes = new Elysia()
  // Public: reviews for a product (visible ones) + aggregate rating.
  .get("/api/products/:idOrSlug/reviews", async ({ params: { idOrSlug } }) => {
    if (!(await isEnabled("reviews"))) return { enabled: false, average: 0, count: 0, reviews: [] };
    const id = await resolveProductId(idOrSlug);
    if (!id) return { enabled: true, average: 0, count: 0, reviews: [] };
    const rows = await db
      .select()
      .from(reviews)
      .where(and(eq(reviews.productId, id), eq(reviews.hidden, false)))
      .orderBy(desc(reviews.createdAt));
    const count = rows.length;
    const average = count ? Math.round((rows.reduce((s, r) => s + r.rating, 0) / count) * 10) / 10 : 0;
    return {
      enabled: true, average, count,
      reviews: rows.map((r) => ({ id: r.id, rating: r.rating, body: r.body, email: maskEmail(r.email), createdAt: r.createdAt })),
    };
  })

  // Customer: can I review this product? (purchased + not already reviewed)
  .get("/api/products/:idOrSlug/can-review", async ({ params: { idOrSlug }, cookie }) => {
    const user = await validateSession(cookie[SESSION_COOKIE]?.value as string | undefined);
    if (!user) return { canReview: false, reason: "not-authenticated" };
    const id = await resolveProductId(idOrSlug);
    if (!id) return { canReview: false, reason: "not-found" };
    if (!(await hasPurchased(user.id, id))) return { canReview: false, reason: "not-purchased" };
    const existing = (await db.select().from(reviews).where(and(eq(reviews.userId, user.id), eq(reviews.productId, id))))[0];
    if (existing) return { canReview: false, reason: "already-reviewed" };
    return { canReview: true };
  })

  // Customer: submit a verified-purchase review.
  .post(
    "/api/products/:idOrSlug/reviews",
    async ({ params: { idOrSlug }, body, cookie, status, set }) => {
      if (!(await isEnabled("reviews"))) return status(403, { error: "Reviews are disabled", code: "DISABLED" });
      const user = await validateSession(cookie[SESSION_COOKIE]?.value as string | undefined);
      if (!user) return status(401, { error: "Sign in to review", code: "UNAUTHENTICATED" });
      const id = await resolveProductId(idOrSlug);
      if (!id) return status(404, { error: "Product not found", code: "NOT_FOUND" });
      if (!(await hasPurchased(user.id, id))) return status(403, { error: "Only buyers can review", code: "NOT_PURCHASED" });
      const existing = (await db.select().from(reviews).where(and(eq(reviews.userId, user.id), eq(reviews.productId, id))))[0];
      if (existing) return status(409, { error: "You already reviewed this", code: "ALREADY_REVIEWED" });
      const row = { id: randomUUID(), productId: id, userId: user.id, email: user.email, rating: body.rating, body: body.body ?? "", hidden: false };
      await db.insert(reviews).values(row);
      set.status = 201;
      return { ok: true };
    },
    { body: t.Object({ rating: t.Integer({ minimum: 1, maximum: 5 }), body: t.Optional(t.String({ maxLength: 1000 })) }) }
  );

export type { SessionUser };
