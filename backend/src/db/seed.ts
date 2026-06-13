import { randomUUID } from "node:crypto";
import { db } from "./connection.ts";
import { productKeys, products, settings } from "./schema.ts";

// USD prices (hand-set for the international store). slug = SEO URL.
const mockProducts = [
  {
    id: "prod-1",
    slug: "chatgpt-plus-1-month",
    name: "ChatGPT Plus — 1 Month",
    priceUsd: 11.99,
    description:
      "Upgrade your ChatGPT account to Plus: access the latest GPT models with priority speed. Activated on your own email.",
    image:
      "https://images.unsplash.com/photo-1677442136019-21780ecad995?auto=format&fit=crop&q=80&w=600",
    category: "AI",
  },
  {
    id: "prod-2",
    slug: "gemini-advanced-pro-12-months",
    name: "Gemini Advanced Pro — 12 Months",
    priceUsd: 17.99,
    description:
      "Activation key for Gemini Advanced (Pro) for 12 months, including 2TB of storage. Key delivered automatically after payment.",
    image:
      "https://images.unsplash.com/photo-1712002641088-9d76f9080889?auto=format&fit=crop&q=80&w=600",
    category: "AI",
  },
  {
    id: "prod-3",
    slug: "spotify-premium-3-months",
    name: "Spotify Premium — 3 Months",
    priceUsd: 4.99,
    description:
      "Genuine Spotify Premium upgrade for 3 months: ad-free music and offline downloads.",
    image:
      "https://images.unsplash.com/photo-1614680376573-df3480f0c6ff?auto=format&fit=crop&q=80&w=600",
    category: "Entertainment",
  },
  {
    id: "prod-4",
    slug: "steam-wallet-10-usd",
    name: "Steam Wallet — $10",
    priceUsd: 10.5,
    description:
      "A $10 Steam Wallet redeem code. Enter it in the Redeem section to top up your balance.",
    image:
      "https://images.unsplash.com/photo-1640955014216-75201056c829?auto=format&fit=crop&q=80&w=600",
    category: "Game",
  },
  {
    id: "prod-5",
    slug: "netflix-premium-1-month",
    name: "Netflix Premium — 1 Month",
    priceUsd: 3.99,
    description:
      "Netflix Premium 4K account for 1 month, one private profile. Account delivered via email.",
    image:
      "https://images.unsplash.com/photo-1574375927938-d5a98e8ffe85?auto=format&fit=crop&q=80&w=600",
    category: "Entertainment",
  },
  {
    id: "prod-6",
    slug: "windows-11-pro-license-key",
    name: "Windows 11 Pro — License Key",
    priceUsd: 6.5,
    description:
      "Lifetime Windows 11 Pro activation key bound to your Microsoft account. 1-on-1 activation support included.",
    image:
      "https://images.unsplash.com/photo-1633419461186-7d40a38105ec?auto=format&fit=crop&q=80&w=600",
    category: "Software",
  },
  {
    id: "prod-7",
    slug: "youtube-premium-6-months",
    name: "YouTube Premium — 6 Months",
    priceUsd: 7.99,
    description:
      "Genuine YouTube Premium upgrade for 6 months: ad-free viewing, background play, offline downloads + YouTube Music.",
    image:
      "https://images.unsplash.com/photo-1611162617474-5b21e879e113?auto=format&fit=crop&q=80&w=600",
    category: "Entertainment",
  },
  {
    id: "prod-8",
    slug: "canva-pro-1-year",
    name: "Canva Pro — 1 Year",
    priceUsd: 9.99,
    description:
      "Canva Pro account for 12 months: premium templates, background remover, brand kit, 1TB storage. Activated via email.",
    image:
      "https://images.unsplash.com/photo-1611224885990-ab7363d1f2a9?auto=format&fit=crop&q=80&w=600",
    category: "Software",
  },
  {
    id: "prod-9",
    slug: "microsoft-365-family-1-year",
    name: "Microsoft 365 Family — 1 Year",
    priceUsd: 12.99,
    description:
      "Microsoft 365 Family key for 12 months, up to 6 people: Word, Excel, PowerPoint + 1TB OneDrive each.",
    image:
      "https://images.unsplash.com/photo-1633419461186-7d40a38105ec?auto=format&fit=crop&q=80&w=600",
    category: "Software",
  },
  {
    id: "prod-10",
    slug: "discord-nitro-1-month",
    name: "Discord Nitro — 1 Month",
    priceUsd: 3.99,
    description:
      "Discord Nitro for 1 month: server-wide emoji, HD streaming, server boost, animated avatar. Delivered via gift link.",
    image:
      "https://images.unsplash.com/photo-1614680376573-df3480f0c6ff?auto=format&fit=crop&q=80&w=600",
    category: "Game",
  },
];

// Demo inventory: how many real keys to seed per product (out-of-stock products get 0).
const stockPlan: Record<string, number> = {
  "prod-1": 25,
  "prod-2": 15,
  "prod-3": 40,
  "prod-4": 20,
  "prod-5": 0,
  "prod-6": 50,
  "prod-7": 30,
  "prod-8": 18,
  "prod-9": 12,
  "prod-10": 0,
};

const defaultSettings: Record<string, string> = {
  store_name: "Nexora",
  ltc_xpub: "", // admin pastes Ltub/Mtub/zpub in the dashboard
  hd_address_type: "", // auto-detected from xpub prefix
  hd_next_index: "0", // monotonic derivation counter
  required_confirmations: "2",
  payment_window_minutes: "15",
  rate_tolerance_litoshi: "1000", // ~0.00001 LTC
  email_enabled: "false",
  email_provider: "",
  email_from: "Nexora <noreply@example.com>",
};

function genCode() {
  const block = () => randomUUID().split("-")[0].toUpperCase();
  return `${block()}-${block()}-${block()}`;
}

async function seed() {
  console.log("🌱 Seeding database...");

  for (const p of mockProducts) {
    await db
      .insert(products)
      .values(p)
      .onConflictDoUpdate({
        target: products.id,
        set: {
          slug: p.slug,
          name: p.name,
          priceUsd: p.priceUsd,
          description: p.description,
          image: p.image,
          category: p.category,
        },
      });

    // Seed real key inventory (fresh DB after reset).
    const n = stockPlan[p.id] ?? 0;
    if (n > 0) {
      const rows = Array.from({ length: n }, () => ({
        id: randomUUID(),
        productId: p.id,
        code: genCode(),
      }));
      await db.insert(productKeys).values(rows);
    }
  }

  for (const [key, value] of Object.entries(defaultSettings)) {
    await db.insert(settings).values({ key, value }).onConflictDoNothing();
  }

  console.log("✅ Seeding completed!");
}

seed().catch(console.error);
