import { randomBytes, createHash } from "crypto";
import { eq } from "drizzle-orm";
import { db } from "../db/connection.ts";
import { users, sessions } from "../db/schema.ts";

/* ───────────────────────── password (argon2id via Bun) ───────────────────────── */
export const hashPassword = (pw: string) =>
  Bun.password.hash(pw, { algorithm: "argon2id", memoryCost: 19456, timeCost: 2 });

export const verifyPassword = (pw: string, hash: string) => Bun.password.verify(pw, hash);

// Dummy hash to equalize timing when an email doesn't exist (anti-enumeration).
const DUMMY_HASH = await hashPassword("x".repeat(24));
export async function verifyLogin(user: { passwordHash: string } | undefined, pw: string): Promise<boolean> {
  if (!user) {
    await verifyPassword(pw, DUMMY_HASH); // spend the same time
    return false;
  }
  return verifyPassword(pw, user.passwordHash);
}

export const normalizeEmail = (email: string) => email.trim().toLowerCase();

/* ───────────────────────── opaque DB-backed sessions ───────────────────────── */
// Raw token lives in the cookie; only SHA-256(token) is stored, so a DB leak can't mint sessions.
const THIRTY_DAYS_MS = 1000 * 60 * 60 * 24 * 30;
export const SESSION_COOKIE = "sid";

const sha256hex = (s: string) => createHash("sha256").update(s).digest("hex");

export async function createSession(userId: string): Promise<{ token: string; expiresAt: number }> {
  const token = randomBytes(32).toString("hex"); // 256-bit
  const id = sha256hex(token);
  const expiresAt = Date.now() + THIRTY_DAYS_MS;
  await db.insert(sessions).values({ token: id, userId, expiresAt: new Date(expiresAt) });
  return { token, expiresAt };
}

export type SessionUser = { id: string; email: string; role: "customer" | "admin" };

export async function validateSession(token: string | undefined): Promise<SessionUser | null> {
  if (!token) return null;
  const id = sha256hex(token);
  const rows = await db.select().from(sessions).where(eq(sessions.token, id));
  const row = rows[0];
  if (!row) return null;
  if (Date.now() > new Date(row.expiresAt).getTime()) {
    await db.delete(sessions).where(eq(sessions.token, id));
    return null;
  }
  const u = (await db.select().from(users).where(eq(users.id, row.userId)))[0];
  if (!u) return null;
  return { id: u.id, email: u.email, role: u.role };
}

export async function destroySession(token: string | undefined): Promise<void> {
  if (!token) return;
  await db.delete(sessions).where(eq(sessions.token, sha256hex(token)));
}

export function sessionCookieOptions(expires: Date) {
  return {
    httpOnly: true,
    secure: Bun.env.NODE_ENV === "production", // dev over http://localhost keeps the cookie
    sameSite: "lax" as const,
    path: "/",
    expires,
  };
}

export function generateOrderToken(orderId: string): string {
  const secret = Bun.env.ADMIN_PASSWORD_HASH ?? "nexora-default-secret-salt-2026";
  return createHash("sha256").update(orderId + secret).digest("hex");
}

export function verifyOrderToken(orderId: string, token: string | undefined): boolean {
  if (!token) return false;
  return generateOrderToken(orderId) === token;
}

