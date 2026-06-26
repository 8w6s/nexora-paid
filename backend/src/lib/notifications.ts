/**
 * Built-in order notification dispatcher.
 *
 * Sends real-time alerts when orders are paid — no plugin needed.
 * Supports Discord webhook, Telegram bot, and generic HTTP POST.
 * Configured via admin settings (notification_discord_webhook, etc.)
 *
 * Fires on hookBus "payment.paid" — registered once at boot.
 */
import { getSetting } from "./settings.ts";
import { hookBus } from "./plugin/hook-bus.ts";

interface PaidEvent {
  orderId: string;
  userId: string | null;
  amountUsd: number;
}

// f-notif-1 (deep audit / loop iter 2, 2026-06-27): admin-set webhook URLs are
// fetched directly by the backend on every paid order. Without validation, an
// admin (or attacker with admin cookie) can point them at internal services
// (Redis/Elasticsearch/Docker socket via http://localhost:*, EC2/GCP metadata
// at 169.254.169.254, k8s API at 10.x, etc.) and the backend will obediently
// POST order JSON to them. The discord/webhook generic endpoint is the most
// exposed because the attacker fully controls the URL.
//
// Allowed: https:// URLs whose hostname does NOT resolve to a loopback/private
// IP literal. We don't do live DNS resolution here (would add a round-trip
// per call and rebind-race anyway); we statically refuse the obvious
// IP-literal SSRF targets that cover ~95% of the attack surface. Cloud
// metadata IPs are the leftover real risk for managed deployments; admins
// should also block them at the network layer (egress firewall).
const PRIVATE_IP_PATTERNS: RegExp[] = [
  /^127\./, // IPv4 loopback
  /^10\./, // IPv4 private class A
  /^192\.168\./, // IPv4 private class C
  /^172\.(1[6-9]|2\d|3[01])\./, // IPv4 private class B
  /^169\.254\./, // IPv4 link-local + cloud metadata
  /^0\./, // IPv4 "this network"
  /^::1?$/, // IPv6 loopback
  /^fe80:/i, // IPv6 link-local
  /^fc00:/i, // IPv6 unique local
  /^fd00:/i,
];

function isSafeWebhookUrl(raw: string, opts?: { allowOnlyHost?: string }): boolean {
  let u: URL;
  try {
    u = new URL(raw);
  } catch {
    return false;
  }
  if (u.protocol !== "https:") return false;
  // URL.hostname preserves brackets around IPv6 literals (e.g. '[::1]').
  // Strip them so the IPv6 regexes see the bare address.
  const host = u.hostname.replace(/^\[|\]$/g, "").toLowerCase();
  if (host === "localhost") return false;
  for (const re of PRIVATE_IP_PATTERNS) {
    if (re.test(host)) return false;
  }
  if (opts?.allowOnlyHost && host !== opts.allowOnlyHost) return false;
  return true;
}

export { isSafeWebhookUrl };

async function sendDiscord(webhookUrl: string, event: PaidEvent): Promise<void> {
  const embed = {
    title: "New Order Paid",
    color: 0x22c55e,
    fields: [
      { name: "Order", value: event.orderId, inline: true },
      { name: "Amount", value: `$${event.amountUsd.toFixed(2)}`, inline: true },
    ],
    timestamp: new Date().toISOString(),
    footer: { text: "Nexora" },
  };
  await fetch(webhookUrl, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ embeds: [embed] }),
    signal: AbortSignal.timeout(10_000),
  });
}

async function sendTelegram(botToken: string, chatId: string, event: PaidEvent): Promise<void> {
  const text = `*New Order Paid*\nOrder: \`${event.orderId}\`\nAmount: $${event.amountUsd.toFixed(2)}`;
  await fetch(`https://api.telegram.org/bot${botToken}/sendMessage`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ chat_id: chatId, text, parse_mode: "Markdown" }),
    signal: AbortSignal.timeout(10_000),
  });
}

async function sendGenericWebhook(url: string, event: PaidEvent): Promise<void> {
  await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ event: "payment.paid", ...event, timestamp: new Date().toISOString() }),
    signal: AbortSignal.timeout(10_000),
  });
}

async function onPaymentPaid(event: PaidEvent): Promise<void> {
  const [discordUrl, tgBot, tgChat, webhookUrl] = await Promise.all([
    getSetting("notification_discord_webhook"),
    getSetting("notification_telegram_bot_token"),
    getSetting("notification_telegram_chat_id"),
    getSetting("notification_webhook_url"),
  ]);

  const tasks: Promise<void>[] = [];

  // Discord webhooks live at discord.com (and exclusively at that host);
  // pin the allowed hostname so an attacker who flips the setting to
  // https://attacker.example/some-path cannot exfil order events.
  if (discordUrl && isSafeWebhookUrl(discordUrl, { allowOnlyHost: "discord.com" })) {
    tasks.push(sendDiscord(discordUrl, event).catch(() => {}));
  } else if (discordUrl) {
    console.warn(
      "[notifications] notification_discord_webhook rejected by SSRF guard; expected https://discord.com/... — skipping",
    );
  }
  if (tgBot && tgChat) tasks.push(sendTelegram(tgBot, tgChat, event).catch(() => {}));
  // Generic webhook: only public https endpoints. Internal/loopback/private/
  // link-local hosts are refused so the backend cannot be conscripted into
  // an SSRF probe against the deployment's own network.
  if (webhookUrl && isSafeWebhookUrl(webhookUrl)) {
    tasks.push(sendGenericWebhook(webhookUrl, event).catch(() => {}));
  } else if (webhookUrl) {
    console.warn(
      "[notifications] notification_webhook_url rejected by SSRF guard; require https + non-private host — skipping",
    );
  }

  await Promise.allSettled(tasks);
}

export function registerNotifications(): void {
  hookBus.subscribe("__notifications", "payment.paid", onPaymentPaid as any);
}