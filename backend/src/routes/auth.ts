import { Elysia, t } from "elysia";
import { randomUUID } from "crypto";
import { eq } from "drizzle-orm";
import { db } from "../db/connection.ts";
import { users } from "../db/schema.ts";
import {
  hashPassword,
  verifyLogin,
  normalizeEmail,
  createSession,
  validateSession,
  destroySession,
  sessionCookieOptions,
  SESSION_COOKIE,
} from "../lib/auth.ts";

/* ───────── auth macros: requireAuth / requireAdmin (Elysia 1.4 macro v2 + resolve) ───────── */
// `resolve` runs after validation, injects a typed `user` into context, and short-circuits
// with `status(...)` when unauthenticated/unauthorized. Use as `{ requireAuth: true }` on a route.
export const authMacros = new Elysia({ name: "auth-macros" }).macro({
  requireAuth: {
    async resolve({ cookie, status }) {
      const user = await validateSession(cookie[SESSION_COOKIE]?.value as string | undefined);
      if (!user) return status(401, { error: "Authentication required", code: "UNAUTHENTICATED" });
      return { user };
    },
  },
  requireAdmin: {
    async resolve({ cookie, status }) {
      const user = await validateSession(cookie[SESSION_COOKIE]?.value as string | undefined);
      if (!user) return status(401, { error: "Authentication required", code: "UNAUTHENTICATED" });
      if (user.role !== "admin") return status(403, { error: "Admin only", code: "FORBIDDEN" });
      return { user };
    },
  },
});

/* ───────── customer auth routes ───────── */
export const authRoutes = new Elysia({ prefix: "/api/auth" })
  .use(authMacros)
  .post(
    "/register",
    async ({ body, cookie, set }) => {
      const email = normalizeEmail(body.email);
      const existing = await db.select().from(users).where(eq(users.email, email));
      if (existing.length > 0) {
        set.status = 409;
        return { error: "Email already registered", code: "EMAIL_TAKEN" };
      }
      const id = randomUUID();
      const passwordHash = await hashPassword(body.password);
      await db.insert(users).values({ id, email, passwordHash, role: "customer" });
      const { token, expiresAt } = await createSession(id);
      cookie[SESSION_COOKIE].set({ value: token, ...sessionCookieOptions(new Date(expiresAt)) });
      set.status = 201;
      return { id, email };
    },
    {
      body: t.Object({
        email: t.String({ format: "email" }),
        password: t.String({ minLength: 8, maxLength: 200 }),
      }),
    }
  )
  .post(
    "/login",
    async ({ body, cookie, set }) => {
      const email = normalizeEmail(body.email);
      const user = (await db.select().from(users).where(eq(users.email, email)))[0];
      const ok = await verifyLogin(user, body.password);
      if (!ok || !user) {
        set.status = 401;
        return { error: "Invalid email or password", code: "BAD_CREDENTIALS" };
      }
      const { token, expiresAt } = await createSession(user.id);
      cookie[SESSION_COOKIE].set({ value: token, ...sessionCookieOptions(new Date(expiresAt)) });
      return { id: user.id, email: user.email, role: user.role };
    },
    { body: t.Object({ email: t.String(), password: t.String() }) }
  )
  .post("/logout", async ({ cookie }) => {
    await destroySession(cookie[SESSION_COOKIE]?.value as string | undefined);
    cookie[SESSION_COOKIE]?.remove();
    return { ok: true };
  })
  .get("/me", async ({ cookie, set }) => {
    const user = await validateSession(cookie[SESSION_COOKIE]?.value as string | undefined);
    if (!user) {
      set.status = 401;
      return { error: "Not authenticated", code: "UNAUTHENTICATED" };
    }
    return { id: user.id, email: user.email, role: user.role };
  });

/* ───────── bootstrap single admin from env ───────── */
// ADMIN_EMAIL + ADMIN_PASSWORD_HASH (an argon2id hash). If only ADMIN_PASSWORD (plaintext) is set
// in dev, we hash it on boot. Upserts a users row with role='admin' so it uses the same session path.
export async function bootstrapAdmin() {
  const email = Bun.env.ADMIN_EMAIL ? normalizeEmail(Bun.env.ADMIN_EMAIL) : null;
  if (!email) {
    console.warn("[admin] ADMIN_EMAIL not set — no admin account bootstrapped.");
    return;
  }
  let passwordHash = Bun.env.ADMIN_PASSWORD_HASH ?? null;
  if (!passwordHash && Bun.env.ADMIN_PASSWORD) {
    passwordHash = await hashPassword(Bun.env.ADMIN_PASSWORD);
  }
  if (!passwordHash) {
    console.warn("[admin] No ADMIN_PASSWORD_HASH / ADMIN_PASSWORD — admin login disabled.");
    return;
  }
  const existing = (await db.select().from(users).where(eq(users.email, email)))[0];
  if (existing) {
    await db.update(users).set({ passwordHash, role: "admin" }).where(eq(users.id, existing.id));
  } else {
    await db.insert(users).values({ id: randomUUID(), email, passwordHash, role: "admin" });
  }
  console.log(`[admin] Admin account ready: ${email}`);
}
