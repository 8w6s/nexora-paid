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
      if (await hasAdmin()) {
        set.status = 409;
        return { error: "Setup already completed", code: "SETUP_DONE" };
      }
      // Validate xpub if provided (per chosen coin).
      if (body.ltcXpub) {
        const v = validateXpub(body.ltcXpub);
        if (!v.ok) { set.status = 400; return { error: `Invalid LTC xpub: ${v.error}`, code: "BAD_XPUB" }; }
      }

      // 1) create the first admin
      const id = randomUUID();
      const email = normalizeEmail(body.adminEmail);
      await db.insert(users).values({ id, email, passwordHash: await hashPassword(body.adminPassword), role: "admin" });

      // 2) branding + wallet
      await setSetting("store_name", body.storeName || "My Shop");
      if (body.faKitUrl) await setSetting("fa_kit_url", body.faKitUrl);
      if (body.ltcXpub) {
        await setSetting("ltc_xpub", body.ltcXpub);
        await setSetting("hd_address_type", validateXpub(body.ltcXpub).ok ? (validateXpub(body.ltcXpub) as any).type : "");
      }

      // 3) feature flags chosen in the wizard (any omitted → keep defaults)
      if (body.features) {
        for (const [k, on] of Object.entries(body.features)) {
          if (k in FEATURES) await setFlag(k as FeatureKey, !!on);
        }
      }

      // 4) auto-login the new admin
      const { token, expiresAt } = await createSession(id);
      cookie[SESSION_COOKIE].set({ value: token, ...sessionCookieOptions(new Date(expiresAt)) });
      set.status = 201;
      return { ok: true, adminId: id, email };
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
