import { validateXpub } from "./hd.ts";

export type SettingDef = {
  key: string;
  type: "string" | "boolean" | "number";
  validate?: (value: any) => { ok: boolean; error?: string };
  transform?: (value: any) => string | boolean | number;
};

/**
 * Settings schema — declarative list of all admin-configurable settings.
 * Replaces ~150 lines of repetitive `if (body.xxx !== undefined) await setSetting(...)`.
 */
export const SETTINGS_SCHEMA: SettingDef[] = [
  // Litecoin / Payments
  {
    key: "ltc_xpub",
    type: "string",
    validate: (v) => {
      if (!v || v.length === 0) return { ok: true }; // Allow empty to skip
      const res = validateXpub(v.trim());
      return res.ok ? { ok: true } : { ok: false, error: res.error };
    },
  },
  { key: "required_confirmations", type: "number" },
  { key: "payment_window_minutes", type: "number" },

  // Store branding
  { key: "store_name", type: "string" },
  { key: "subdomain", type: "string" },
  { key: "currency", type: "string" },
  { key: "description", type: "string" },

  // Social links
  { key: "discord", type: "string" },
  { key: "youtube", type: "string" },
  { key: "telegram", type: "string" },
  { key: "tiktok", type: "string" },
  { key: "instagram", type: "string" },

  // Checkout toggles
  { key: "allow_change_theme", type: "boolean" },
  { key: "collect_billing", type: "boolean" },
  { key: "show_coupon", type: "boolean" },
  { key: "show_terms", type: "boolean" },
  { key: "precheck_terms", type: "boolean" },
  { key: "show_newsletter", type: "boolean" },

  // Invoices & Tax
  { key: "enable_tax_calculation", type: "boolean" },
  { key: "tax_rate", type: "number" },
  { key: "send_invoice_pdfs", type: "boolean" },
  { key: "show_invoice_pdf_link", type: "boolean" },
  { key: "invoice_pdf_header", type: "string" },
  { key: "invoice_pdf_notes", type: "string" },
  { key: "invoice_pdf_footer", type: "string" },

  // Feedbacks
  { key: "enable_automatic_feedbacks", type: "boolean" },

  // Affiliate program
  { key: "enable_affiliate_program", type: "boolean" },
  { key: "make_affiliate_program_public", type: "boolean" },
  { key: "allow_customers_edit_affiliate_code", type: "boolean" },
  { key: "affiliate_percentage", type: "number" },

  // Tickets
  { key: "enable_tickets", type: "boolean" },

  // Legal pages
  { key: "terms_of_service", type: "string" },
  { key: "privacy_policy", type: "string" },
  { key: "refund_policy", type: "string" },

  // Integrations
  { key: "google_analytics", type: "string" },
  { key: "crisp", type: "string" },
  { key: "tawk_to", type: "string" },
  { key: "trustpilot", type: "string" },

  // Discord integration
  { key: "discord_client_id", type: "string" },
  { key: "discord_client_secret", type: "string" },
  { key: "discord_bot_token", type: "string" },

  // SEO & Meta
  { key: "meta_title", type: "string" },
  { key: "meta_description", type: "string" },
  { key: "meta_twitter_card", type: "string" },

  // Checkout color scheme
  { key: "checkout_color_scheme", type: "string" },

  // Miscellaneous
  { key: "redirect_custom_domain", type: "boolean" },
  { key: "hide_out_of_stock", type: "boolean" },
  { key: "refund_out_of_stock_to_balance", type: "boolean" },
  { key: "maintenance_password", type: "string" },
  { key: "custom_domain_name", type: "string" },
  { key: "maintenance_mode", type: "boolean" },
  { key: "custom_header_script", type: "string" },
];

/**
 * Apply settings schema to an incoming request body.
 * Returns array of [key, value, error] tuples.
 */
export async function processSettingsBody(
  body: Record<string, any>,
): Promise<{ key: string; value: string | boolean; error?: string }[]> {
  const results: { key: string; value: string | boolean; error?: string }[] = [];

  for (const def of SETTINGS_SCHEMA) {
    const incomingValue = body[def.key];
    if (incomingValue === undefined) continue;

    // Validate if a validator exists
    if (def.validate) {
      const validation = def.validate(incomingValue);
      if (!validation.ok) {
        results.push({
          key: def.key,
          value: "",
          error: validation.error || `Invalid value for ${def.key}`,
        });
        continue;
      }
    }

    // Transform to storage format
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
