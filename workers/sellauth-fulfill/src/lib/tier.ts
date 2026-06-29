/**
 * Tier policy — single source of truth for how SellAuth variants map to
 * license payload fields. Keep in lockstep with the description docs at
 * docs/sellauth/nexora-{licenses,lts}.md.
 */
export type Tier = "6mo" | "1yr" | "lifetime" | "lts";

const DAY_MS = 86_400_000;

const VARIANT_TO_TIER: Record<string, Tier> = {
  // SellAuth-style slugs
  "6-month": "6mo",
  "6-months": "6mo",
  "6mo": "6mo",
  "1-year": "1yr",
  "1-yr": "1yr",
  "1y": "1yr",
  yearly: "1yr",
  lifetime: "lifetime",
  perpetual: "lifetime",
  lts: "lts",
  frozen: "lts",
};

export function mapVariantToTier(variant: string | undefined): Tier {
  if (!variant) return "6mo";
  const key = variant.trim().toLowerCase().replace(/\s+/g, "-");
  return VARIANT_TO_TIER[key] ?? "6mo";
}

function iso(ms: number): string {
  return new Date(ms).toISOString();
}

export interface TierExpiry {
  expiresAt?: string;
  updatesUntil?: string;
}

export function computeExpiry(tier: Tier, now: number): TierExpiry {
  switch (tier) {
    case "6mo":
      return {
        expiresAt: iso(now + 180 * DAY_MS),
        updatesUntil: iso(now + 180 * DAY_MS),
      };
    case "1yr":
      return {
        expiresAt: iso(now + 365 * DAY_MS),
        updatesUntil: iso(now + 365 * DAY_MS),
      };
    case "lifetime":
      return {}; // no caps
    case "lts":
      // App never expires, but updater refuses to apply anything past the
      // build timestamp. updatesUntil = purchase time → no future updates.
      return { updatesUntil: iso(now) };
  }
}

export function tierLabel(tier: Tier): string {
  switch (tier) {
    case "6mo":
      return "6 months of updates";
    case "1yr":
      return "1 year of updates";
    case "lifetime":
      return "lifetime updates";
    case "lts":
      return "frozen build, no auto-updates";
  }
}