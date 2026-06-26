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

  if (discordUrl) tasks.push(sendDiscord(discordUrl, event).catch(() => {}));
  if (tgBot && tgChat) tasks.push(sendTelegram(tgBot, tgChat, event).catch(() => {}));
  if (webhookUrl) tasks.push(sendGenericWebhook(webhookUrl, event).catch(() => {}));

  await Promise.allSettled(tasks);
}

export function registerNotifications(): void {
  hookBus.subscribe("__notifications", "payment.paid", onPaymentPaid as any);
}