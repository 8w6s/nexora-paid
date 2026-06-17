import { validateXpub } from "./hd.ts";

export type SettingDef = {
  key: string;
  type: "string" | "boolean" | "number";
  validate?: (value: any) => { ok: boolean; error?: string };
  transform?: (value: any) => string | boolean | number;
  // dangerous=true marks fields whose value is rendered raw into HTML
  // (currently only custom_header_script). Right now used as documentation
  // for reviewers; future work can gate writes behind owner-level RBAC.
  dangerous?: true;
  // Hard byte cap enforced in processSettingsBody. Prevents megabyte
  // payloads from sneaking into ascii-string fields like terms_of_service
  // or custom_header_script.
  maxLength?: number;
};

// Numeric range helper. Out-of-range writes are skipped at the caller
// (processSettingsBody returns an error and the route doesn't persist).
function inRange(min: number, max: number, label: string) {
  return (v: any) => {
    const n = Number(v);
    if (!Number.isFinite(n)) return { ok: false, error: `${label} must be a number` };
    if (n < min || n > max) {
      return { ok: false, error: `${label} must be between ${min} and ${max}` };
    }
    return { ok: true };
  };
}

/**
 * Settings schema. Declarative list of every admin-configurable setting,
 * replacing ~150 lines of repetitive
 * `if (body.xxx !== undefined) await setSetting(...)` in the route handler.
 */
export const SETTINGS_SCHEMA: SettingDef[] = [
  // Litecoin / Payments
  {
    key: "ltc_xpub",
    type: "string",
    validate: (v) => {
      if (!v || v.length === 0) return { ok: true }; // Allow empty to skip.
      const res = validateXpub(v.trim());
      return res.ok ? { ok: true } : { ok: false, error: res.error };
    },
  },
  {
    key: "required_confirmations",
    type: "number",
    // Block negative confirmations (instant payouts on unconfirmed tx) and
    // ridiculous values that would expire orders before any block can land.
    validate: inRange(1, 64, "Required confirmations"),
  },
  {
    key: "payment_window_minutes",
    type: "number",
    validate: inRange(1, 1440, "Payment window minutes"),
  },

  // Store branding
  { key: "store_name", type: "string", maxLength: 200 },
  { key: "subdomain", type: "string", maxLength: 100 },
  { key: "currency", type: "string", maxLength: 10 },
  { key: "description", type: "string", maxLength: 2000 },

  // Social links
  { key: "discord", type: "string", maxLength: 500 },
  { key: "youtube", type: "string", maxLength: 500 },
  { key: "telegram", type: "string", maxLength: 500 },
  { key: "tiktok", type: "string", maxLength: 500 },
  { key: "instagram", type: "string", maxLength: 500 },

  // Checkout toggles
  { key: "allow_change_theme", type: "boolean" },
  { key: "collect_billing", type: "boolean" },
  { key: "show_coupon", type: "boolean" },
  { key: "show_terms", type: "boolean" },
  { key: "precheck_terms", type: "boolean" },
  { key: "show_newsletter", type: "boolean" },

  // Invoices & Tax
  { key: "enable_tax_calculation", type: "boolean" },
  {
    key: "tax_rate",
    type: "number",
    // Negative tax = discount; rate above 100% = nonsense. Clamp.
    validate: inRange(0, 100, "Tax rate (%)"),
  },
  { key: "send_invoice_pdfs", type: "boolean" },
  { key: "show_invoice_pdf_link", type: "boolean" },
  { key: "invoice_pdf_header", type: "string", maxLength: 4000 },
  { key: "invoice_pdf_notes", type: "string", maxLength: 4000 },
  { key: "invoice_pdf_footer", type: "string", maxLength: 4000 },

  // Feedbacks
  { key: "enable_automatic_feedbacks", type: "boolean" },

  // Affiliate program
  { key: "enable_affiliate_program", type: "boolean" },
  { key: "make_affiliate_program_public", type: "boolean" },
  { key: "allow_customers_edit_affiliate_code", type: "boolean" },
  {
    key: "affiliate_percentage",
    type: "number",
    // Above-100% would pay out more in commission than the order.
    validate: inRange(0, 100, "Affiliate percentage"),
  },

  // Tickets
  { key: "enable_tickets", type: "boolean" },

  // Legal pages — large blocks of HTML/Markdown but still capped.
  { key: "terms_of_service", type: "string", maxLength: 50_000 },
  { key: "privacy_policy", type: "string", maxLength: 50_000 },
  { key: "refund_policy", type: "string", maxLength: 50_000 },

  // Integrations
  { key: "google_analytics", type: "string", maxLength: 200 },
  { key: "crisp", type: "string", maxLength: 200 },
  { key: "tawk_to", type: "string", maxLength: 200 },
  { key: "trustpilot", type: "string", maxLength: 200 },

  // Discord integration
  { key: "discord_client_id", type: "string", maxLength: 100 },
  { key: "discord_client_secret", type: "string", maxLength: 200 },
  { key: "discord_bot_token", type: "string", maxLength: 200 },

  // SEO & Meta
  { key: "meta_title", type: "string", maxLength: 200 },
  { key: "meta_description", type: "string", maxLength: 500 },
  { key: "meta_twitter_card", type: "string", maxLength: 50 },

  // Checkout color scheme
  { key: "checkout_color_scheme", type: "string", maxLength: 50 },

  // Miscellaneous
  { key: "redirect_custom_domain", type: "boolean" },
  { key: "hide_out_of_stock", type: "boolean" },
  { key: "refund_out_of_stock_to_balance", type: "boolean" },
  { key: "maintenance_password", type: "string", maxLength: 200 },
  { key: "custom_domain_name", type: "string", maxLength: 253 },
  { key: "maintenance_mode", type: "boolean" },
  {
    // DANGEROUS: rendered raw into <head> of every storefront page. Any
    // admin who can write this key can effectively run JavaScript on every
    // visitor. The schema marks it dangerous=true so reviewers see the
    // surface; for now the only enforced control is the 4 KB length cap.
    key: "custom_header_script",
    type: "string",
    dangerous: true,
    maxLength: 4096,
  },
];

/**
 * Apply settings schema to an incoming request body. Rows with validation
 * errors are RETURNED with an `error` field but no `value` — the caller is
 * responsible for either short-circuiting on those rows or skipping them.
 *
 * Pre-audit this pushed `value: ""` on validation errors. Some callers
 * iterate the list and call setSetting() unconditionally — passing `""`
 * would silently overwrite a previously-stored xpub or secret with empty
 * string. Now value is omitted on error so a misuse becomes a TS error
 * (or at minimum an undefined-write the caller has to handle).
 */
export async function processSettingsBody(
  body: Record<string, any>,
): Promise<{ key: string; value?: string | boolean; error?: string }[]> {
  const results: { key: string; value?: string | boolean; error?: string }[] = [];

  for (const def of SETTINGS_SCHEMA) {
    const incomingValue = body[def.key];
    if (incomingValue === undefined) continue;

    // Length cap before validate so a 50 MB pasted blob doesn't run a
    // potentially-expensive validator (e.g. the xpub regex+derive).
    if (
      def.maxLength !== undefined &&
      typeof incomingValue === "string" &&
      incomingValue.length > def.maxLength
    ) {
      results.push({
        key: def.key,
        error: `${def.key} exceeds ${def.maxLength}-character limit`,
      });
      continue;
    }

    if (def.validate) {
      const validation = def.validate(incomingValue);
      if (!validation.ok) {
        results.push({
          key: def.key,
          error: validation.error || `Invalid value for ${def.key}`,
        });
        continue;
      }
    }

    let toStore: string | boolean | number = incomingValue;
    if (def.type === "boolean") {
      toStore = incomingValue ? "true" : "false";
    } else if (def.type === "number") {
      toStore = String(incomingValue);
    } else {
      toStore = String(incomingValue || "");
    }

    results.push({ key: def.key, value: toStore });
  }

  return results;
}