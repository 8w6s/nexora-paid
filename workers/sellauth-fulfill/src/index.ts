/**
 * SellAuth Dynamic Delivery handler.
 *
 *   POST /deliver         — verify HMAC, build invoice + license, return markdown
 *   GET  /health          — liveness ping (Cloudflare uptime checks)
 *   GET  /                — diagnostic (no auth, no secrets)
 *
 * Flow on /deliver:
 *   1. Read raw body once (HMAC verify and JSON parse must see same bytes).
 *   2. Verify x-sellauth-signature against SELLAUTH_WEBHOOK_SECRET.
 *   3. Extract email + variant + order_id from SellAuth payload.
 *   4. Encrypt "email:invoice_id:tier" into customers.txt format.
 *   5. PUT-append it to nexora-releases/customers.txt via GitHub API
 *      (auto-build.yml on that repo will pick it up).
 *   6. Ed25519-sign the license payload inline.
 *   7. Return markdown to SellAuth; SellAuth emails it to the buyer.
 *
 * Failure modes:
 *   - Bad signature → 401, nothing committed, SellAuth shows "delivery failed".
 *   - GitHub commit fails → 500, SellAuth retries. Worker is idempotent at
 *     the SellAuth retry level (same order_id → same invoice_id, dedupe on
 *     customers.txt happens at the auto-build pipeline downstream).
 *   - Unknown variant → defaults to "6mo". Worth logging but not fatal.
 */
import { encryptCustomerLine, signLicensePayload, verifyHmacSignature } from "./lib/crypto.ts";
import { buildDeliveryMarkdown } from "./lib/delivery.ts";
import { appendLineToFile } from "./lib/github.ts";
import { computeExpiry, mapVariantToTier, tierLabel, type Tier } from "./lib/tier.ts";

export interface Env {
  // Secrets — wrangler secret put <name>
  SELLAUTH_WEBHOOK_SECRET: string;
  NEXORA_CUSTOMERS_KEY: string;
  LICENSE_SIGNING_KEY_HEX: string;
  GH_PAT: string;
  // Vars — wrangler.toml [vars]
  GH_REPO: string;
  GH_BRANCH: string;
  CUSTOMERS_PATH: string;
  PRODUCT_ID: string;
  SUPPORTED_FEATURES: string;
  // Optional overrides (set with `wrangler secret put` or [vars]).
  INSTALL_URL?: string;
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
  // RFC-shaped sanity check — SellAuth already validates, this is belt+suspenders.
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(raw)) return null;
  return raw;
}

function pickVariant(evt: SellAuthEvent): string {
  return (evt.variant ?? evt.variant_name ?? "").trim();
}

function buildInvoiceId(orderId: string | number | undefined): string {
  // Stable, derived from SellAuth order id so retries dedupe.
  const sanitized = String(orderId ?? "").replace(/[^A-Za-z0-9._-]/g, "");
  if (sanitized.length >= 4 && sanitized.length <= 60) return `inv_${sanitized}`;
  // Fallback: random — only fires when SellAuth didn't send a usable order_id.
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

async function handleDeliver(req: Request, env: Env): Promise<Response> {
  if (req.method !== "POST") return fail(405, "POST required");

  const rawBody = await req.text();
  const sigHeader =
    req.headers.get("x-sellauth-signature") ??
    req.headers.get("x-signature") ??
    req.headers.get("x-webhook-signature") ??
    "";

  const sigOk = await verifyHmacSignature(env.SELLAUTH_WEBHOOK_SECRET, rawBody, sigHeader);
  if (!sigOk) {
    console.warn("[fulfill] reject: bad signature");
    return fail(401, "bad signature");
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

  // Append encrypted line to customers.txt — triggers auto-build.yml.
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
    installUrl: env.INSTALL_URL ?? "https://install.nexora.sh/setup.sh",
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
          tiers: ["6mo", "1yr", "lifetime", "lts"].map((t) => ({
            tier: t,
            label: tierLabel(t as Tier),
          })),
        }),
        "application/json",
      );
    }
    if (url.pathname === "/deliver") return handleDeliver(req, env);
    return fail(404, "not found");
  },
};