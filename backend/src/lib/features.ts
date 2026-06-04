import { getAllSettings, setSetting } from "./settings.ts";

/**
 * Feature flags for the clone-and-run boilerplate. Almost every module can be toggled by the
 * admin (stored in the settings table as `feature_<key>`). Defaults are chosen so a fresh clone
 * runs as a sensible shop out of the box. Read flags via isEnabled(); the frontend gets them
 * from GET /api/config (public, only booleans + safe display values — never secrets).
 */

export const FEATURES = {
  reviews: { label: "Product reviews", default: true },
  coupons: { label: "Discount coupons", default: true },
  wishlist: { label: "Wishlist", default: true },
  tickets: { label: "Support tickets", default: true },
  flash_sale: { label: "Flash sales", default: true },
  search: { label: "Search & filters", default: true },
  dark_mode: { label: "Dark mode toggle", default: true },
  related_products: { label: "Related products", default: true },
  email: { label: "Transactional email", default: false },
  email_verify: { label: "Email verification (encouraged)", default: false },
  captcha: { label: "Anti-bot challenge", default: true },
  realtime: { label: "Realtime notifications (SSE)", default: true },
  coin_LTC: { label: "Accept Litecoin", default: true },
  coin_BTC: { label: "Accept Bitcoin", default: false },
  coin_ETH: { label: "Accept Ethereum", default: false },
} as const;

export type FeatureKey = keyof typeof FEATURES;

export async function getFlags(): Promise<Record<FeatureKey, boolean>> {
  const s = await getAllSettings();
  const out = {} as Record<FeatureKey, boolean>;
  for (const key of Object.keys(FEATURES) as FeatureKey[]) {
    const v = s[`feature_${key}`];
    out[key] = v == null ? FEATURES[key].default : v === "true";
  }
  return out;
}

export async function isEnabled(key: FeatureKey): Promise<boolean> {
  return (await getFlags())[key];
}

export async function setFlag(key: FeatureKey, on: boolean): Promise<void> {
  await setSetting(`feature_${key}`, on ? "true" : "false");
}

// Whether the store has at least one payment coin enabled (used by checkout guard).
export async function enabledCoins(): Promise<("LTC" | "BTC" | "ETH")[]> {
  const f = await getFlags();
  const coins: ("LTC" | "BTC" | "ETH")[] = [];
  if (f.coin_LTC) coins.push("LTC");
  if (f.coin_BTC) coins.push("BTC");
  if (f.coin_ETH) coins.push("ETH");
  return coins;
}
