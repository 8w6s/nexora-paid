/**
 * USD → LTC exchange rate for checkout.
 * Primary: Kraken public Ticker (real LTC/USD, no auth). Fallback: Coinbase spot.
 * Process-wide ~60s cache; the rate is LOCKED per order at checkout (see lockOrderRate).
 */

type Quote = { usdPerLtc: number; source: string; fetchedAt: number };

let cache: Quote | null = null;
const TTL_MS = 60_000;
const FETCH_TIMEOUT_MS = 4_000;

async function fetchJson(url: string): Promise<any> {
  const ac = new AbortController();
  const t = setTimeout(() => ac.abort(), FETCH_TIMEOUT_MS);
  try {
    const r = await fetch(url, { signal: ac.signal, headers: { accept: "application/json" } });
    if (!r.ok) throw new Error(`http_${r.status}`);
    return await r.json();
  } finally {
    clearTimeout(t);
  }
}

// PRIMARY: Kraken — real LTC/USD, no auth.
async function fromKraken(): Promise<number> {
  const j = await fetchJson("https://api.kraken.com/0/public/Ticker?pair=LTCUSD");
  if (j.error?.length) throw new Error(j.error.join(","));
  const k = Object.keys(j.result)[0]; // e.g. "XLTCZUSD"
  const last = Number(j.result[k].c[0]); // last trade price
  if (!(last > 0)) throw new Error("bad kraken price");
  return last;
}

// FALLBACK: Coinbase retail spot — no auth.
async function fromCoinbase(): Promise<number> {
  const j = await fetchJson("https://api.coinbase.com/v2/prices/LTC-USD/spot");
  const amt = Number(j?.data?.amount);
  if (!(amt > 0)) throw new Error("bad coinbase price");
  return amt;
}

export async function getUsdPerLtc(): Promise<Quote> {
  const now = Date.now();
  if (cache && now - cache.fetchedAt < TTL_MS) return cache;
  try {
    cache = { usdPerLtc: await fromKraken(), source: "kraken", fetchedAt: now };
  } catch {
    try {
      cache = { usdPerLtc: await fromCoinbase(), source: "coinbase", fetchedAt: now };
    } catch (_e) {
      if (cache) return cache; // last-good if both upstreams fail
      throw new Error("no LTC rate available");
    }
  }
  return cache;
}

// LTC has 8 decimals (1 LTC = 1e8 litoshi). Round the amount OWED *up* so the buyer never
// underpays due to truncation. Returns both the integer litoshi target and an 8dp display string.
export function usdToLitoshi(
  usd: number,
  usdPerLtc: number,
): { litoshi: number; ltcAmount: string } {
  const litoshi = Math.ceil((usd / usdPerLtc) * 1e8);
  return { litoshi, ltcAmount: (litoshi / 1e8).toFixed(8) };
}

// At ORDER CREATION: lock the rate onto the order; never re-quote a live order.
export async function lockOrderRate(usdTotal: number, windowMinutes: number) {
  const q = await getUsdPerLtc();
  const { litoshi, ltcAmount } = usdToLitoshi(usdTotal, q.usdPerLtc);
  const now = Date.now();
  return {
    ltcRate: q.usdPerLtc,
    rateSource: q.source,
    ltcAmount, // 8dp display string
    expectedLitoshi: litoshi, // integer target
    rateLockedAt: now,
    expiresAt: now + windowMinutes * 60_000,
  };
}
