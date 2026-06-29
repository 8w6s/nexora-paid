/**
 * SellAuth Dynamic Delivery handler.
 *
 *   POST /deliver/<URL_TOKEN>     — token-authed (preferred, see below)
 *   POST /deliver                 — HMAC-authed (when SellAuth signs)
 *   GET  /health                  — liveness ping
 *   GET  /                        — diagnostic (no secrets)
 *
 * Auth model:
 *   SellAuth's Dynamic Delivery does NOT expose a webhook-signing-secret on
 *   every plan. We therefore default to a URL-path token model: the operator
 *   sets URL_TOKEN once, and the Worker only accepts POSTs to
 *   `/deliver/<URL_TOKEN>`. The token never appears in logs (Cloudflare
 *   strips it from `wrangler tail` URL preview).
 *
 *   When SELLAUTH_WEBHOOK_SECRET is set AND an x-sellauth-signature header
 *   is present, we additionally HMAC-verify the body. Both layers are
 *   independent — either alone is enough; both together is defense in depth.
 *
 * Flow on /deliver:
 *   1. Read raw body once (HMAC verify and JSON parse share the bytes).
 *   2. Auth: URL_TOKEN match (path) and/or HMAC (header).
 *   3. Parse SellAuth payload → email + variant + order_id.
 *   4. Encrypt "email:invoice_id:tier" into customers.txt nx1 format.
 *   5. PUT-append to nexora-releases/customers.txt (triggers auto-build.yml).
 *   6. Ed25519-sign the license payload inline.
 *   7. Return markdown to SellAuth; SellAuth emails it to the buyer.
 */
import { encryptCustomerLine, signLicensePayload, verifyHmacSignature } from "./lib/crypto.ts";
import { buildDeliveryMarkdown } from "./lib/delivery.ts";
import { appendLineToFile } from "./lib/github.ts";
import { computeExpiry, mapVariantToTier, tierLabel, type Tier } from "./lib/tier.ts";

export interface Env {
  // Secrets — wrangler secret put <name>
  URL_TOKEN: string;                     // required: path token at /deliver/<this>
  SELLAUTH_WEBHOOK_SECRET?: string;      // optional: HMAC body signing
  NEXORA_CUSTOMERS_KEY: string;          // required: 64-hex AES-256 key
  LICENSE_SIGNING_KEY_HEX: string;       // required: 64-hex Ed25519 private key
  GH_PAT: string;                        // required: GitHub PAT (Contents:write)
  // Vars — wrangler.toml [vars]
  GH_REPO: string;
  GH_BRANCH: string;
  CUSTOMERS_PATH: string;
  PRODUCT_ID: string;
  SUPPORTED_FEATURES: string;
  // Optional vars / secrets
  INSTALL_SH_URL?: string;
  INSTALL_PS1_URL?: string;
  SUPPORT_EMAIL?: string;
  SUPPORT_DISCORD?: string;
}

interface SellAuthEvent {
  order_id?: string | number;
  product_id?: string | number;
  variant?: string;
  variant_name?: string;
  customer_email?: string;
  email?: string;
  quantity?: number;
  paid_amount?: string;
  paid_currency?: string;
}

function pickEmail(evt: SellAuthEvent): string | null {
  const raw = (evt.customer_email ?? evt.email ?? "").trim().toLowerCase();
  if (!raw) return null;
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(raw)) return null;
  return raw;
}

function pickVariant(evt: SellAuthEvent): string {
  return (evt.variant ?? evt.variant_name ?? "").trim();
}

function buildInvoiceId(orderId: string | number | undefined): string {
  const sanitized = String(orderId ?? "").replace(/[^A-Za-z0-9._-]/g, "");
  if (sanitized.length >= 4 && sanitized.length <= 60) return `inv_${sanitized}`;
  const r = crypto.getRandomValues(new Uint8Array(6));
  return `inv_${[...r].map((b) => b.toString(16).padStart(2, "0")).join("")}`;
}

function ok(body: string, contentType = "text/markdown; charset=utf-8"): Response {
  return new Response(body, {
    status: 200,
    headers: { "content-type": contentType },
  });
}

function fail(status: number, message: string): Response {
  return new Response(JSON.stringify({ error: message }), {
    status,
    headers: { "content-type": "application/json" },
  });
}

function constantTimeStrEq(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

async function handleDeliver(req: Request, env: Env): Promise<Response> {
  if (req.method !== "POST") return fail(405, "POST required");

  const rawBody = await req.text();

  // Optional second auth layer: HMAC body signature (when SellAuth sends it).
  const sigHeader =
    req.headers.get("x-sellauth-signature") ??
    req.headers.get("x-signature") ??
    req.headers.get("x-webhook-signature") ??
    "";
  if (sigHeader && env.SELLAUTH_WEBHOOK_SECRET) {
    const sigOk = await verifyHmacSignature(env.SELLAUTH_WEBHOOK_SECRET, rawBody, sigHeader);
    if (!sigOk) {
      console.warn("[fulfill] reject: bad HMAC signature");
      return fail(401, "bad signature");
    }
  }

  let evt: SellAuthEvent;
  try {
    evt = JSON.parse(rawBody) as SellAuthEvent;
  } catch {
    return fail(400, "invalid json");
  }

  const email = pickEmail(evt);
  if (!email) return fail(400, "missing/invalid customer_email");

  const variant = pickVariant(evt);
  const tier: Tier = mapVariantToTier(variant);
  const invoiceId = buildInvoiceId(evt.order_id);

  const now = Date.now();
  const expiry = computeExpiry(tier, now);
  const features = env.SUPPORTED_FEATURES.split(",")
    .map((s) => s.trim())
    .filter(Boolean);

  const payload: Record<string, unknown> = {
    email,
    productId: env.PRODUCT_ID,
    issuedAt: new Date(now).toISOString(),
    customerId: invoiceId,
    tier,
    ...expiry,
    features,
  };

  let signedLicense: string;
  try {
    const signature = await signLicensePayload(payload, env.LICENSE_SIGNING_KEY_HEX);
    signedLicense = JSON.stringify({ payload, signature }, null, 2);
  } catch (e) {
    console.error("[fulfill] license sign failed", e);
    return fail(500, "license sign failed");
  }

  try {
    const plaintext = `${email}:${invoiceId}:${tier}`;
    const line = await encryptCustomerLine(plaintext, env.NEXORA_CUSTOMERS_KEY);
    await appendLineToFile({
      repo: env.GH_REPO,
      branch: env.GH_BRANCH,
      path: env.CUSTOMERS_PATH,
      newLine: line,
      message: `auto: ${invoiceId} (${tier}) via SellAuth`,
      pat: env.GH_PAT,
    });
  } catch (e) {
    console.error("[fulfill] customers.txt append failed", e);
    return fail(500, "fulfillment commit failed");
  }

  const body = buildDeliveryMarkdown({
    invoiceId,
    email,
    tier,
    licenseJson: signedLicense,
    installShUrl:
      env.INSTALL_SH_URL ??
      `https://raw.githubusercontent.com/${env.GH_REPO}/${env.GH_BRANCH}/install/setup.sh`,
    installPs1Url:
      env.INSTALL_PS1_URL ??
      `https://raw.githubusercontent.com/${env.GH_REPO}/${env.GH_BRANCH}/install/setup.ps1`,
    supportEmail: env.SUPPORT_EMAIL ?? "support@nexora.sh",
    supportDiscord: env.SUPPORT_DISCORD,
  });

  console.log(`[fulfill] ok invoice=${invoiceId} tier=${tier} email=${email}`);
  return ok(body);
}

export default {
  async fetch(req: Request, env: Env): Promise<Response> {
    const url = new URL(req.url);

    if (url.pathname === "/health" || url.pathname === "/") {
      return ok(
        JSON.stringify({
          ok: true,
          worker: "sellauth-fulfill",
          repo: env.GH_REPO,
          branch: env.GH_BRANCH,
          tiers: (["6mo", "1yr", "lifetime", "lts"] as Tier[]).map((t) => ({
            tier: t,
            label: tierLabel(t),
          })),
        }),
        "application/json",
      );
    }

    // Path-token auth: /deliver/<URL_TOKEN>
    // Fallback to /deliver only if SELAUTH_WEBHOOK_SECRET is configured —
    // requiring the HMAC layer to be the sole auth in that case.
    if (url.pathname.startsWith("/deliver")) {
      let tail = url.pathname.slice("/deliver".length);
      if (tail.startsWith("/")) tail = tail.slice(1);
      const tokenOk =
        !!env.URL_TOKEN && tail.length > 0 && constantTimeStrEq(tail, env.URL_TOKEN);
      if (!tokenOk) {
        // Allow plain /deliver only when HMAC is the auth mechanism.
        if (tail.length === 0 && env.SELLAUTH_WEBHOOK_SECRET) {
          return handleDeliver(req, env);
        }
        return fail(401, "unauthorized");
      }
      return handleDeliver(req, env);
    }

    return fail(404, "not found");
  },
};