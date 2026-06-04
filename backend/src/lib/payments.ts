import { getAllSettings, setSetting } from "./settings.ts";

/**
 * Payment provider registry for the full-customize shop. Each provider is a module the shop owner
 * can enable + configure in admin. Providers declare which countries they serve, so the storefront
 * can show only the methods available for the buyer's (or shop's) country.
 *
 * "kind" groups the integration style:
 *   - crypto-native : self-hosted HD wallet (LTC/BTC/ETH) — already implemented, no 3rd party
 *   - crypto-gateway: hosted crypto processor (OxaPay) — API key
 *   - card          : card processor with embedded element (Stripe) — PCI-safe, styled in-shop
 *   - wallet        : redirect/wallet processors (PayPal, PayPay)
 *   - manual        : offline bank transfer / QR, admin confirms
 *
 * Secrets (api keys/secrets) live in the settings table under pay_<id>_<field> and are NEVER
 * returned to the client; the public config only exposes enabled + non-secret display fields.
 */

export type ProviderKind = "crypto-native" | "crypto-gateway" | "card" | "wallet" | "manual";

export interface ProviderField {
  key: string;        // stored as pay_<id>_<key>
  label: string;
  secret?: boolean;   // never sent to client; masked as boolean in admin GET
  optional?: boolean;
  hint?: string;      // optional helper text shown under the input
  placeholder?: string;
}

export interface ProviderDef {
  id: string;
  label: string;
  kind: ProviderKind;
  /** ISO country codes served, or "*" for worldwide. */
  countries: string[] | "*";
  defaultOn: boolean;
  fields: ProviderField[];
  note?: string;
}

// "*" = worldwide. Country lists are indicative; admin can still force-enable any provider.
export const PROVIDERS: ProviderDef[] = [
  {
    id: "crypto_ltc", label: "Litecoin (self-hosted)", kind: "crypto-native", countries: "*", defaultOn: true,
    fields: [{ key: "xpub", label: "Litecoin extended public key", placeholder: "Ltub… / Mtub… / zpub… / vpub…", hint: "An xpub/zpub — NOT a single address (ltc1q… won't work). It lets us derive a fresh address per order." }],
    note: "Self-custody HD wallet — no third party, no fees.",
  },
  {
    id: "crypto_btc", label: "Bitcoin (self-hosted)", kind: "crypto-native", countries: "*", defaultOn: false,
    fields: [{ key: "xpub", label: "Bitcoin extended public key", placeholder: "xpub… / ypub… / zpub…", hint: "An xpub/ypub/zpub — not a single bc1… address." }],
  },
  {
    id: "crypto_eth", label: "Ethereum (self-hosted)", kind: "crypto-native", countries: "*", defaultOn: false,
    fields: [{ key: "xpub", label: "Ethereum xpub" }, { key: "etherscan_key", label: "Etherscan API key", secret: true }],
  },
  {
    id: "oxapay", label: "OxaPay (crypto gateway)", kind: "crypto-gateway", countries: "*", defaultOn: false,
    fields: [{ key: "merchant_key", label: "OxaPay merchant API key", secret: true }],
    note: "Hosted crypto processor — supports many coins, they handle the blockchain.",
  },
  {
    id: "stripe", label: "Stripe (cards)", kind: "card",
    countries: ["US", "GB", "CA", "AU", "SG", "JP", "DE", "FR", "NL", "IE", "VN"], defaultOn: false,
    fields: [
      { key: "publishable_key", label: "Stripe publishable key" },
      { key: "secret_key", label: "Stripe secret key", secret: true },
      { key: "webhook_secret", label: "Webhook signing secret", secret: true, optional: true },
    ],
    note: "Cards via Stripe Elements embedded in your own styled checkout (PCI-safe).",
  },
  {
    id: "paypal", label: "PayPal", kind: "wallet",
    countries: ["US", "GB", "CA", "AU", "DE", "FR", "NL", "IE", "SG", "JP"], defaultOn: false,
    fields: [
      { key: "client_id", label: "PayPal client ID" },
      { key: "client_secret", label: "PayPal client secret", secret: true },
    ],
  },
  {
    id: "paypay", label: "PayPay (Japan)", kind: "wallet", countries: ["JP"], defaultOn: false,
    fields: [
      { key: "api_key", label: "PayPay API key" },
      { key: "api_secret", label: "PayPay API secret", secret: true },
      { key: "merchant_id", label: "Merchant ID" },
    ],
  },
  {
    id: "bank_manual", label: "Bank transfer (manual)", kind: "manual", countries: "*", defaultOn: false,
    fields: [
      { key: "instructions", label: "Payment instructions (shown to buyer)" },
      { key: "qr_image_url", label: "QR image URL", optional: true },
    ],
    note: "Buyer pays offline; you confirm orders manually in admin.",
  },
];

export const PROVIDER_BY_ID = Object.fromEntries(PROVIDERS.map((p) => [p.id, p]));

const k = (id: string, field: string) => `pay_${id}_${field}`;
const enabledKey = (id: string) => `pay_${id}_enabled`;

export async function isProviderEnabled(id: string): Promise<boolean> {
  const s = await getAllSettings();
  const def = PROVIDER_BY_ID[id];
  if (!def) return false;
  const v = s[enabledKey(id)];
  return v == null ? def.defaultOn : v === "true";
}

export async function getProviderConfig(id: string): Promise<Record<string, string>> {
  const s = await getAllSettings();
  const def = PROVIDER_BY_ID[id];
  if (!def) return {};
  const out: Record<string, string> = {};
  for (const f of def.fields) out[f.key] = s[k(id, f.key)] ?? "";
  return out;
}

export async function setProviderEnabled(id: string, on: boolean): Promise<void> {
  await setSetting(enabledKey(id), on ? "true" : "false");
}

export async function setProviderField(id: string, field: string, value: string): Promise<void> {
  await setSetting(k(id, field), value);
}

// The shop's country (admin-set) used to filter which providers are offered by default.
export async function getShopCountry(): Promise<string> {
  return (await getAllSettings()).shop_country ?? "*";
}

function servesCountry(def: ProviderDef, country: string): boolean {
  if (def.countries === "*") return true;
  if (country === "*") return true; // shop hasn't restricted
  return def.countries.includes(country);
}

// Admin view: every provider with enabled + config (secrets masked to booleans).
export async function adminProviderList() {
  const s = await getAllSettings();
  return PROVIDERS.map((def) => {
    const config: Record<string, string | boolean> = {};
    for (const f of def.fields) {
      const raw = s[k(def.id, f.key)] ?? "";
      config[f.key] = f.secret ? !!raw : raw; // secret -> boolean "is set"
    }
    return {
      id: def.id, label: def.label, kind: def.kind, countries: def.countries, note: def.note,
      fields: def.fields, enabled: (s[enabledKey(def.id)] ?? String(def.defaultOn)) === "true", config,
    };
  });
}

// Public storefront view: enabled providers serving the shop country (or overrides), no secrets, no config values.
export async function publicProviderList(countryOverride?: string) {
  const country = countryOverride || await getShopCountry();
  const out: { id: string; label: string; kind: ProviderKind }[] = [];
  for (const def of PROVIDERS) {
    if (!(await isProviderEnabled(def.id))) continue;
    if (!servesCountry(def, country)) continue;
    out.push({ id: def.id, label: def.label, kind: def.kind });
  }
  return out;
}
