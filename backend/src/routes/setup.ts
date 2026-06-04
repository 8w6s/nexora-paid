import { Elysia, t } from "elysia";
import { randomUUID } from "crypto";
import { eq } from "drizzle-orm";
import { db } from "../db/connection.ts";
import { users } from "../db/schema.ts";
import { hashPassword, normalizeEmail, createSession, sessionCookieOptions, SESSION_COOKIE } from "../lib/auth.ts";
import { setSetting } from "../lib/settings.ts";
import { setFlag, type FeatureKey, FEATURES } from "../lib/features.ts";
import { validateXpub } from "../lib/hd.ts";

async function hasAdmin(): Promise<boolean> {
  return (await db.select({ id: users.id }).from(users).where(eq(users.role, "admin"))).length > 0;
}

// First-run setup wizard. Only usable while NO admin exists — locks itself afterward, so a
// freshly cloned shop can be configured entirely from the browser with no file editing.
export const setupRoutes = new Elysia({ prefix: "/api/setup" })
  .get("/status", async () => ({ needsSetup: !(await hasAdmin()) }))
  .post(
    "/",
    async ({ body, cookie, set }) => {
      // Validate xpub OUTSIDE the transaction so we don't open one for
      // requests that will be rejected on input shape anyway.
      let xpubType: string | null = null;
      if (body.ltcXpub) {
        const v = validateXpub(body.ltcXpub);
        if (!v.ok) { set.status = 400; return { error: `Invalid LTC xpub: ${v.error}`, code: "BAD_XPUB" }; }
        xpubType = (v as { type?: string }).type ?? null;
      }

      // Hash the password BEFORE the transaction. argon2id is slow on purpose
      // (>100ms) and holding a write transaction during that window would
      // serialize all DB writes for the whole shop. We re-check hasAdmin()
      // inside the transaction so a concurrent setup attempt still rolls back.
      const id = randomUUID();
      const email = normalizeEmail(body.adminEmail);
      const passwordHash = await hashPassword(body.adminPassword);

      // Race guard: hasAdmin() outside-then-INSERT had a TOCTOU window where
      // two concurrent requests could both observe "no admin" and both insert
      // their own first-admin row. SQLite serializes write transactions, so
      // re-checking inside the transaction closes the window — the loser
      // throws and we translate to 409.
      let created: { id: string; email: string } | null = null;
      try {
        created = await db.transaction(async (tx) => {
          const existing = await tx.select({ id: users.id }).from(users).where(eq(users.role, "admin"));
          if (existing.length > 0) {
            // Throw to abort the transaction; caller maps to a 409.
            throw new Error("SETUP_DONE");
          }
          await tx.insert(users).values({ id, email, passwordHash, role: "admin" });
          return { id, email };
        });
      } catch (e) {
        if (e instanceof Error && e.message === "SETUP_DONE") {
          set.status = 409;
          return { error: "Setup already completed", code: "SETUP_DONE" };
        }
        throw e;
      }

      // 2) branding + wallet — outside the admin-creation transaction so a
      // settings hiccup can't lose the admin row. Each setSetting() is its
      // own write; the admin already exists in the DB and the wizard can be
      // resumed via /admin if any of these fail.
      await setSetting("store_name", body.storeName || "My Shop");
      if (body.faKitUrl) await setSetting("fa_kit_url", body.faKitUrl);
      if (body.ltcXpub) {
        await setSetting("ltc_xpub", body.ltcXpub);
        if (xpubType) await setSetting("hd_address_type", xpubType);
      }

      // 3) feature flags chosen in the wizard (any omitted → keep defaults)
      if (body.features) {
        for (const [k, on] of Object.entries(body.features)) {
          if (k in FEATURES) await setFlag(k as FeatureKey, !!on);
        }
      }

      // 4) auto-login the new admin
      const { token, expiresAt } = await createSession(created.id);
      cookie[SESSION_COOKIE].set({ value: token, ...sessionCookieOptions(new Date(expiresAt)) });
      set.status = 201;
      return { ok: true, adminId: created.id, email: created.email };
    },
    {
      body: t.Object({
        adminEmail: t.String({ format: "email" }),
        adminPassword: t.String({ minLength: 8, maxLength: 200 }),
        storeName: t.Optional(t.String()),
        faKitUrl: t.Optional(t.String()),
        ltcXpub: t.Optional(t.String()),
        features: t.Optional(t.Record(t.String(), t.Boolean())),
      }),
    }
  );
