/**
 * Cloudflare Worker — LemonSqueezy webhook → GitHub repository_dispatch proxy.
 *
 * Verifies the X-Signature header from LemonSqueezy (HMAC-SHA256) before
 * forwarding the order_paid event to the fulfill workflow. This ensures only
 * verified payment events trigger license signing.
 *
 * Environment variables (set in Cloudflare dashboard or wrangler.toml):
 *   LEMONSQUEEZY_WEBHOOK_SECRET — signing secret from LemonSqueezy webhook config
 *   GITHUB_PAT — fine-grained PAT with contents:read+write on nexora-paid repo
 *   GITHUB_REPO — e.g. "8w6s/nexora-paid"
 *
 * Deploy: npx wrangler deploy scripts/webhook-proxy/worker.js --name nexora-webhook
 */

export default {
  async fetch(request, env) {
    if (request.method !== "POST") {
      return new Response("Method not allowed", { status: 405 });
    }

    const signature = request.headers.get("x-signature");
    if (!signature) {
      return new Response("Missing signature", { status: 401 });
    }

    const body = await request.text();

    // Verify HMAC-SHA256 signature
    const key = await crypto.subtle.importKey(
      "raw",
      new TextEncoder().encode(env.LEMONSQUEEZY_WEBHOOK_SECRET),
      { name: "HMAC", hash: "SHA-256" },
      false,
      ["sign"],
    );
    const expected = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(body));
    const expectedHex = [...new Uint8Array(expected)]
      .map((b) => b.toString(16).padStart(2, "0"))
      .join("");

    if (signature !== expectedHex) {
      return new Response("Invalid signature", { status: 403 });
    }

    // Parse LemonSqueezy payload
    let payload;
    try {
      payload = JSON.parse(body);
    } catch {
      return new Response("Bad JSON", { status: 400 });
    }

    // Only process order_created / order_paid events
    const eventName = request.headers.get("x-event-name");
    if (eventName !== "order_created" && eventName !== "subscription_payment_success") {
      return new Response("Event ignored", { status: 200 });
    }

    const email = payload.data?.attributes?.user_email
      || payload.meta?.custom_data?.email
      || "";
    const orderId = payload.data?.id || "";
    const variantName = payload.data?.attributes?.first_order_item?.variant_name || "standard";
    const tier = variantName.toLowerCase().includes("lifetime") ? "lifetime" : "standard";

    if (!email || !orderId) {
      return new Response("Missing email or order ID in payload", { status: 422 });
    }

    // Forward to GitHub repository_dispatch
    const ghResponse = await fetch(
      `https://api.github.com/repos/${env.GITHUB_REPO}/dispatches`,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${env.GITHUB_PAT}`,
          Accept: "application/vnd.github.v3+json",
          "Content-Type": "application/json",
          "User-Agent": "nexora-webhook-proxy/1.0",
        },
        body: JSON.stringify({
          event_type: "order_paid",
          client_payload: {
            email,
            customer_id: orderId,
            tier,
            idempotency_key: `ls_${orderId}`,
          },
        }),
      },
    );

    if (!ghResponse.ok) {
      const err = await ghResponse.text();
      return new Response(`GitHub API error: ${ghResponse.status} ${err}`, { status: 502 });
    }

    return new Response(JSON.stringify({ ok: true, order: orderId, tier }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  },
};