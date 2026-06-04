import { Elysia, t } from "elysia";
import { randomUUID } from "crypto";
import { eq, desc } from "drizzle-orm";
import { db } from "../db/connection.ts";
import { tickets, ticketMessages } from "../db/schema.ts";
import { validateSession, SESSION_COOKIE } from "../lib/auth.ts";
import { isEnabled } from "../lib/features.ts";
import { logAdminAction } from "../lib/audit.ts";
import { EmailService } from "../lib/email.ts";

async function requireUser(cookie: any) {
  return validateSession(cookie[SESSION_COOKIE]?.value as string | undefined);
}

// Customer-facing support tickets (gated by the "tickets" feature flag).
export const ticketRoutes = new Elysia()
  .get("/api/tickets", async ({ cookie, status }) => {
    if (!(await isEnabled("tickets"))) return status(403, { error: "Tickets disabled", code: "DISABLED" });
    const user = await requireUser(cookie);
    if (!user) return status(401, { error: "Sign in", code: "UNAUTHENTICATED" });
    return db.select().from(tickets).where(eq(tickets.userId, user.id)).orderBy(desc(tickets.updatedAt));
  })

  .get("/api/tickets/:id", async ({ params: { id }, cookie, status }) => {
    const user = await requireUser(cookie);
    if (!user) return status(401, { error: "Sign in", code: "UNAUTHENTICATED" });
    const tk = (await db.select().from(tickets).where(eq(tickets.id, id)))[0];
    if (!tk || (tk.userId !== user.id && user.role !== "admin")) return status(404, { error: "Not found", code: "NOT_FOUND" });
    const msgs = await db.select().from(ticketMessages).where(eq(ticketMessages.ticketId, id)).orderBy(ticketMessages.createdAt);
    return { ...tk, messages: msgs };
  })

  .post(
    "/api/tickets",
    async ({ body, cookie, status, set }) => {
      if (!(await isEnabled("tickets"))) return status(403, { error: "Tickets disabled", code: "DISABLED" });
      const user = await requireUser(cookie);
      if (!user) return status(401, { error: "Sign in", code: "UNAUTHENTICATED" });
      const id = randomUUID();
      await db.insert(tickets).values({ id, userId: user.id, email: user.email, subject: body.subject, orderId: body.orderId ?? null });
      await db.insert(ticketMessages).values({ id: randomUUID(), ticketId: id, fromAdmin: false, body: body.message });
      set.status = 201;
      return { id };
    },
    { body: t.Object({ subject: t.String({ minLength: 1 }), message: t.String({ minLength: 1 }), orderId: t.Optional(t.String()) }) }
  )

  .post(
    "/api/tickets/:id/reply",
    async ({ params: { id }, body, cookie, status, set }) => {
      const user = await requireUser(cookie);
      if (!user) return status(401, { error: "Sign in", code: "UNAUTHENTICATED" });
      const tk = (await db.select().from(tickets).where(eq(tickets.id, id)))[0];
      if (!tk || (tk.userId !== user.id && user.role !== "admin")) return status(404, { error: "Not found", code: "NOT_FOUND" });
      if (tk.status === "closed") return status(400, { error: "Ticket closed", code: "CLOSED" });
      const fromAdmin = user.role === "admin" && tk.userId !== user.id;
      await db.insert(ticketMessages).values({ id: randomUUID(), ticketId: id, fromAdmin, body: body.message });
      await db.update(tickets).set({ updatedAt: new Date() }).where(eq(tickets.id, id));
      // Notify the customer by email when an admin replies (best-effort; no-op if email is off).
      if (user.role === "admin") void EmailService.ticketReply(tk.email, tk.subject, body.message);
      set.status = 201;
      return { ok: true };
    },
    { body: t.Object({ message: t.String({ minLength: 1 }) }) }
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
    const rows = st === "open" || st === "closed"
      ? await db.select().from(tickets).where(eq(tickets.status, st)).orderBy(desc(tickets.updatedAt))
      : await db.select().from(tickets).orderBy(desc(tickets.updatedAt));
    return rows;
  })
  .put(
    "/tickets/:id/status",
    async ({ params: { id }, body, cookie }) => {
      await db.update(tickets).set({ status: body.status, updatedAt: new Date() }).where(eq(tickets.id, id));
      const admin = await validateSession(cookie[SESSION_COOKIE]?.value as string | undefined);
      await logAdminAction(admin?.email ?? "unknown", `ticket.${body.status === "closed" ? "close" : "reopen"}`, id);
      return { ok: true };
    },
    { body: t.Object({ status: t.Union([t.Literal("open"), t.Literal("closed")]) }) }
  );
