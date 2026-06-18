import { getAllSettings } from "./settings.ts";

/**
 * Optional, toggleable transactional email. TRUE no-op when disabled/unconfigured — neither
 * provider package is imported unless actually used (lazy import). Email is best-effort: a send
 * failure must never block order delivery (keys are always shown on-site in My Orders).
 *
 * Config resolution: DB settings table first, then env. Secrets (resend_api_key / smtp_pass)
 * are read but never returned by the admin API.
 */

type Provider = "resend" | "smtp";
interface EmailConfig {
  enabled: boolean;
  provider: Provider | null;
  from: string;
  resendApiKey?: string;
  smtp?: { host: string; port: number; secure: boolean; user: string; pass: string };
}

async function loadConfig(): Promise<EmailConfig> {
  const s = await getAllSettings();
  const env = Bun.env;
  const provider = (s.email_provider ?? env.EMAIL_PROVIDER) as Provider | undefined;
  const enabled = (s.email_enabled ?? env.EMAIL_ENABLED) === "true";
  return {
    enabled,
    provider: provider ?? null,
    from: s.email_from ?? env.SMTP_FROM ?? "Nexora <noreply@example.com>",
    resendApiKey: s.resend_api_key ?? env.RESEND_API_KEY ?? undefined,
    smtp: {
      host: s.smtp_host ?? env.SMTP_HOST ?? "",
      port: Number(s.smtp_port ?? env.SMTP_PORT ?? 587),
      secure: (s.smtp_secure ?? env.SMTP_SECURE) === "true",
      user: s.smtp_user ?? env.SMTP_USER ?? "",
      pass: s.smtp_pass ?? env.SMTP_PASS ?? "",
    },
  };
}

function configured(c: EmailConfig): boolean {
  if (!c.enabled || !c.provider) return false;
  if (c.provider === "resend") return !!c.resendApiKey;
  if (c.provider === "smtp") return !!(c.smtp?.host && c.smtp?.user);
  return false;
}

type SendInput = {
  to: string;
  subject: string;
  html: string;
  text: string;
  idempotencyKey?: string;
};
type SendResult = { skipped: true } | { id: string } | { error: string };

async function send(input: SendInput): Promise<SendResult> {
  const c = await loadConfig();
  if (!configured(c)) return { skipped: true }; // ← true no-op, no provider import
  try {
    if (c.provider === "resend") {
      // @ts-expect-error optional dependency, installed only if you use Resend
      const { Resend } = await import("resend"); // lazy/optional
      const resend = new Resend(c.resendApiKey!);
      const { data, error } = await resend.emails.send(
        { from: c.from, to: input.to, subject: input.subject, html: input.html, text: input.text },
        input.idempotencyKey ? { idempotencyKey: input.idempotencyKey } : undefined,
      );
      if (error) return { error: error.message ?? String(error) };
      return { id: data?.id ?? "sent" };
    } else {
      // @ts-expect-error optional dependency, installed only if you use SMTP
      const nodemailer = await import("nodemailer"); // lazy/optional
      const t = nodemailer.createTransport({
        host: c.smtp?.host,
        port: c.smtp?.port,
        secure: c.smtp?.secure,
        auth: { user: c.smtp?.user, pass: c.smtp?.pass },
      });
      const info = await t.sendMail({
        from: c.from,
        to: input.to,
        subject: input.subject,
        html: input.html,
        text: input.text,
      });
      return { id: info.messageId };
    }
  } catch (e) {
    return { error: e instanceof Error ? e.message : String(e) };
  }
}

const esc = (s: string) =>
  s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]!);

function renderDeliveredKeys(orderId: string, keys: { name: string; code: string }[]) {
  const rows = keys
    .map(
      (k) =>
        `<tr><td style="font-family:monospace;font-size:15px;padding:10px 14px;background:#0f172a;color:#a5f3fc;border-radius:6px">${esc(k.code)}</td></tr>`,
    )
    .join('<tr><td style="height:8px"></td></tr>');
  const html = `<!doctype html><html><body style="margin:0;background:#f1f5f9;font-family:Arial,sans-serif;color:#0f172a"><table width="100%" cellpadding="0" cellspacing="0"><tr><td align="center" style="padding:32px 16px"><table width="560" cellpadding="0" cellspacing="0" style="background:#fff;border-radius:12px;overflow:hidden"><tr><td style="background:#4f46e5;padding:22px 28px;color:#fff;font-size:20px;font-weight:bold">Nexora</td></tr><tr><td style="padding:28px"><h1 style="margin:0 0 8px;font-size:21px">Your order is ready</h1><p style="margin:0 0 18px;color:#475569;font-size:14px">Order <strong>${esc(orderId)}</strong> — payment confirmed. Here ${keys.length > 1 ? "are your keys" : "is your key"}:</p><table width="100%" cellpadding="0" cellspacing="0">${rows}</table><p style="margin:18px 0 0;color:#94a3b8;font-size:12px">Keep these private — anyone with the code can redeem it.</p></td></tr></table></td></tr></table></body></html>`;
  const text = `Your order ${orderId} is ready.\n\n${keys.map((k) => `  ${k.name}: ${k.code}`).join("\n")}\n\nKeep these private.\n— Nexora`;
  return { html, text };
}

function renderPasswordReset(resetUrl: string, expiresMinutes: number) {
  const html = `<!doctype html><html><body style="margin:0;background:#f1f5f9;font-family:Arial,sans-serif;color:#0f172a"><table width="100%" cellpadding="0" cellspacing="0"><tr><td align="center" style="padding:32px 16px"><table width="560" cellpadding="0" cellspacing="0" style="background:#fff;border-radius:12px;overflow:hidden"><tr><td style="background:#4f46e5;padding:22px 28px;color:#fff;font-size:20px;font-weight:bold">Nexora</td></tr><tr><td style="padding:28px"><h1 style="margin:0 0 8px;font-size:21px">Reset your password</h1><p style="margin:0 0 18px;color:#475569;font-size:14px">Someone (hopefully you) asked to reset the password for your Nexora account. The link below expires in ${expiresMinutes} minutes and can only be used once.</p><p style="margin:0 0 22px"><a href="${esc(resetUrl)}" style="display:inline-block;background:#4f46e5;color:#fff;text-decoration:none;padding:12px 22px;border-radius:8px;font-weight:600;font-size:14px">Reset password</a></p><p style="margin:0 0 12px;color:#475569;font-size:13px">Or paste this URL into your browser:</p><p style="margin:0 0 18px;color:#0f172a;font-size:12px;word-break:break-all;background:#f1f5f9;padding:10px 12px;border-radius:6px">${esc(resetUrl)}</p><p style="margin:18px 0 0;color:#94a3b8;font-size:12px">If you didn't request this, you can ignore this email — your password won't change.</p></td></tr></table></td></tr></table></body></html>`;
  const text = `Reset your Nexora password

Use this link within ${expiresMinutes} minutes (single use):

${resetUrl}

If you didn't request this, ignore this email — your password won't change.
— Nexora`;
  return { html, text };
}

function renderTicketReply(subject: string, body: string) {
  const html = `<!doctype html><html><body style="margin:0;background:#f1f5f9;font-family:Arial,sans-serif;color:#0f172a"><table width="100%" cellpadding="0" cellspacing="0"><tr><td align="center" style="padding:32px 16px"><table width="560" cellpadding="0" cellspacing="0" style="background:#fff;border-radius:12px;overflow:hidden"><tr><td style="background:#4f46e5;padding:22px 28px;color:#fff;font-size:20px;font-weight:bold">Nexora Support</td></tr><tr><td style="padding:28px"><h1 style="margin:0 0 8px;font-size:19px">Re: ${esc(subject)}</h1><p style="margin:0 0 16px;color:#475569;font-size:14px">Our support team replied to your ticket:</p><div style="padding:14px 16px;background:#f8fafc;border-left:3px solid #4f46e5;border-radius:6px;font-size:14px;line-height:1.6;white-space:pre-wrap">${esc(body)}</div><p style="margin:18px 0 0;color:#94a3b8;font-size:12px">Reply from your account under Support to continue the conversation.</p></td></tr></table></td></tr></table></body></html>`;
  const text = `Nexora Support replied to "${subject}":\n\n${body}\n\nReply from your account under Support to continue.\n— Nexora`;
  return { html, text };
}

// Strip CR/LF from an email-header source value to prevent SMTP header
// injection (an attacker who can put a CRLF into the subject could append
// `Bcc: ...` and silently fan out the email). Cap length defensively too.
const SAFE_HEADER_RE = /[\r]+/g;
const safeHeader = (s: string, max = 200) => s.replace(SAFE_HEADER_RE, " ").slice(0, max);

export const EmailService = {
  deliveredKeys: (orderId: string, to: string, keys: { name: string; code: string }[]) =>
    send({
      to,
      subject: safeHeader(`Your Nexora order ${orderId} — keys inside`),
      idempotencyKey: `delivered-keys/${orderId}`,
      ...renderDeliveredKeys(orderId, keys),
    }),
  ticketReply: (to: string, subject: string, body: string) =>
    send({
      to,
      subject: safeHeader(`Re: ${subject} — Nexora Support`),
      ...renderTicketReply(subject, body),
    }),
  passwordReset: (to: string, resetUrl: string, expiresMinutes: number) =>
    send({
      to,
      subject: safeHeader("Reset your Nexora password"),
      ...renderPasswordReset(resetUrl, expiresMinutes),
    }),
  // Notify the OLD address when the email-on-record changes. Best-effort —
  // if email is unconfigured / fails the change still proceeds, but a
  // legitimate owner who didn't request it gets a heads-up to recover.
  emailChangedNotice: (to: string, newEmail: string) => {
    const safeNew = safeHeader(newEmail, 254).replace(/[<>"']/g, "");
    return send({
      to,
      subject: safeHeader("Your Nexora account email was changed"),
      html: `<p>The email address on your Nexora account was just changed to <strong>${esc(safeNew)}</strong>.</p><p>If you did this, you can ignore this message. If you did NOT do this, contact the shop operator immediately — your account may have been compromised.</p>`,
      text: `The email address on your Nexora account was just changed to ${safeNew}.

If you did this, ignore this message. If you did NOT do this, contact the shop operator immediately — your account may have been compromised.

— Nexora`,
    });
  },
  lowStockAlert: (to: string, productName: string, remaining: number) => {
    // Sanitize the subject line so an attacker who can name a product can't
    // smuggle CRLF / quotes into the SMTP envelope (header injection).
    const safeName = safeHeader(productName, 120).replace(/"/g, " ");
    return send({
      to,
      subject: `[Low Stock Warning] Product "${safeName}" is running out!`,
      html: `<p>Warning: Product <strong>${esc(productName)}</strong> has only <strong>${remaining}</strong> keys remaining in stock.</p><p>Please replenish the keys as soon as possible.</p>`,
      text: `Low Stock Warning: Product "${safeName}" has only ${remaining} keys remaining. Please replenish stock.`,
    });
  },
};
