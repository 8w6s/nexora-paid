import { randomUUID } from "node:crypto";
import { desc, eq } from "drizzle-orm";
import { Elysia, t } from "elysia";
import { db } from "../db/connection.ts";
import { ticketMessages, tickets } from "../db/schema.ts";
import { logAdminAction } from "../lib/audit.ts";
import { SESSION_COOKIE, validateSession } from "../lib/auth.ts";
import { EmailService } from "../lib/email.ts";
import { isEnabled } from "../lib/features.ts";
import { rateLimitCheck } from "../lib/rate-limit.ts";

// Cap ticket creation + reply rate so a single user can't flood the admin
// inbox or spam an open ticket with thousands of message rows. 10 mutations
// per minute per user is well above any human pace; over that = automation.
const TICKET_MUTATE_MAX = 10;
const TICKET_MUTATE_WINDOW_MS = 60_000;

async function requireUser(cookie: any) {
  return validateSession(cookie[SESSION_COOKIE]?.value as string | undefined);
}

// Customer-facing support tickets (gated by the "tickets" feature flag).
export const ticketRoutes = new Elysia()
  .get("/api/tickets", async ({ cookie, status }) => {
    if (!(await isEnabled("tickets")))
      return status(403, { error: "Tickets disabled", code: "DISABLED" });
    const user = await requireUser(cookie);
    if (!user) return status(401, { error: "Sign in", code: "UNAUTHENTICATED" });
    return db
      .select()
      .from(tickets)
      .where(eq(tickets.userId, user.id))
      .orderBy(desc(tickets.updatedAt));
  })

  .get("/api/tickets/:id", async ({ params: { id }, cookie, status }) => {
    const user = await requireUser(cookie);
    if (!user) return status(401, { error: "Sign in", code: "UNAUTHENTICATED" });
    const tk = (await db.select().from(tickets).where(eq(tickets.id, id)))[0];
    if (!tk || (tk.userId !== user.id && user.role !== "admin"))
      return status(404, { error: "Not found", code: "NOT_FOUND" });
    const msgs = await db
      .select()
      .from(ticketMessages)
      .where(eq(ticketMessages.ticketId, id))
      .orderBy(ticketMessages.createdAt);
    return { ...tk, messages: msgs };
  })

  .post(
    "/api/tickets",
    async ({ body, cookie, status, set }) => {
      if (!(await isEnabled("tickets")))
        return status(403, { error: "Tickets disabled", code: "DISABLED" });
      const user = await requireUser(cookie);
      if (!user) return status(401, { error: "Sign in", code: "UNAUTHENTICATED" });
      const rl = rateLimitCheck(
        `ticket-mutate:${user.id}`,
        TICKET_MUTATE_MAX,
        TICKET_MUTATE_WINDOW_MS,
      );
      if (!rl.allowed) {
        set.status = 429;
        set.headers["Retry-After"] = String(Math.ceil(rl.resetMs / 1000));
        return {
          error: "Too many tickets, slow down",
          code: "RATE_LIMITED",
          retryAfterMs: rl.resetMs,
        };
      }
      const cleanSubject = body.subject.replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g, "").trim();
      const cleanMessage = body.message.replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g, "").trim();
      if (!cleanSubject || !cleanMessage)
        return status(400, { error: "Subject and message required", code: "EMPTY" });
      // Verify the orderId, when supplied, actually belongs to this user — a
      // hostile customer could otherwise attach an arbitrary order id (incl.
      // someone else's GG-XXXX) to their ticket and gain a referenced
      // tooltip in admin UI hover. Validate at write time.
      if (body.orderId) {
        // Lazy import to avoid a circular dep at top-of-file.
        const { orders } = await import("../db/schema.ts");
        const o = (
          await db
            .select({ id: orders.id, userId: orders.userId })
            .from(orders)
            .where(eq(orders.id, body.orderId))
        )[0];
        if (!o || (o.userId !== user.id && user.role !== "admin")) {
          return status(400, { error: "Unknown order id", code: "BAD_ORDER" });
        }
      }
      const id = randomUUID();
      await db.insert(tickets).values({
        id,
        userId: user.id,
        email: user.email,
        subject: cleanSubject,
        orderId: body.orderId ?? null,
      });
      await db
        .insert(ticketMessages)
        .values({ id: randomUUID(), ticketId: id, fromAdmin: false, body: cleanMessage });
      set.status = 201;
      return { id };
    },
    {
      body: t.Object({
        subject: t.String({ minLength: 1, maxLength: 200 }),
        message: t.String({ minLength: 1, maxLength: 8000 }),
        orderId: t.Optional(t.String({ maxLength: 64 })),
      }),
    },
  )

  .post(
    "/api/tickets/:id/reply",
    async ({ params: { id }, body, cookie, status, set }) => {
      const user = await requireUser(cookie);
      if (!user) return status(401, { error: "Sign in", code: "UNAUTHENTICATED" });
      // Same per-user mutation cap as ticket creation. Admins bypass — staff
      // legitimately need to burst-reply during inbox triage.
      if (user.role !== "admin") {
        const rl = rateLimitCheck(
          `ticket-mutate:${user.id}`,
          TICKET_MUTATE_MAX,
          TICKET_MUTATE_WINDOW_MS,
        );
        if (!rl.allowed) {
          set.status = 429;
          set.headers["Retry-After"] = String(Math.ceil(rl.resetMs / 1000));
          return {
            error: "Too many replies, slow down",
            code: "RATE_LIMITED",
            retryAfterMs: rl.resetMs,
          };
        }
      }
      const tk = (await db.select().from(tickets).where(eq(tickets.id, id)))[0];
      if (!tk || (tk.userId !== user.id && user.role !== "admin"))
        return status(404, { error: "Not found", code: "NOT_FOUND" });
      if (tk.status === "closed") return status(400, { error: "Ticket closed", code: "CLOSED" });
      const cleanMessage = body.message.replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g, "").trim();
      if (!cleanMessage) return status(400, { error: "Empty message", code: "EMPTY" });
      const fromAdmin = user.role === "admin" && tk.userId !== user.id;
      await db
        .insert(ticketMessages)
        .values({ id: randomUUID(), ticketId: id, fromAdmin, body: cleanMessage });
      await db.update(tickets).set({ updatedAt: new Date() }).where(eq(tickets.id, id));
      // Notify the customer by email when an admin replies (best-effort; no-op if email is off).
      if (user.role === "admin") void EmailService.ticketReply(tk.email, tk.subject, cleanMessage);
      set.status = 201;
      return { ok: true };
    },
    { body: t.Object({ message: t.String({ minLength: 1, maxLength: 8000 }) }) },
  );

// Admin-side ticket management (mounted under /api/admin via the admin guard separately).
export const adminTicketRoutes = new Elysia({ prefix: "/api/admin" })
  .onBeforeHandle(async ({ cookie, status }) => {
    const user = await validateSession(cookie[SESSION_COOKIE]?.value as string | undefined);
    if (!user) return status(401, { error: "Authentication required", code: "UNAUTHENTICATED" });
    if (user.role !== "admin") return status(403, { error: "Admin only", code: "FORBIDDEN" });
    return;
  })
  .get("/tickets", async ({ query }) => {
    const st = (query as Record<string, string>).status;
    const rows =
      st === "open" || st === "closed"
        ? await db
            .select()
            .from(tickets)
            .where(eq(tickets.status, st))
            .orderBy(desc(tickets.updatedAt))
        : await db.select().from(tickets).orderBy(desc(tickets.updatedAt));
    return rows;
  })
  .put(
    "/tickets/:id/status",
    async ({ params: { id }, body, cookie }) => {
      await db
        .update(tickets)
        .set({ status: body.status, updatedAt: new Date() })
        .where(eq(tickets.id, id));
      const admin = await validateSession(cookie[SESSION_COOKIE]?.value as string | undefined);
      await logAdminAction(
        admin?.email ?? "unknown",
        `ticket.${body.status === "closed" ? "close" : "reopen"}`,
        id,
      );
      return { ok: true };
    },
    { body: t.Object({ status: t.Union([t.Literal("open"), t.Literal("closed")]) }) },
  );
