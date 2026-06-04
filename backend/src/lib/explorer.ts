/**
 * Litecoin payment detection for a single watch-only address.
 * Primary: BlockCypher ltc/main (keyless). Fallback: litecoinspace.org (Esplora fork, independent).
 * All on-wire amounts are LITOSHIS (integer, 1 LTC = 1e8). Verified live 2026-06-01.
 */

export type AddrStatus = {
  receivedLitoshi: number; // confirmed total received (cumulative)
  pendingLitoshi: number; // mempool / unconfirmed
  maxConfirmations: number; // best confirmations among funding txs
  txid?: string; // a funding txid (for paid_tx_id)
};

const TIMEOUT_MS = 6000;

async function fetchJson(url: string): Promise<any> {
  const ac = new AbortController();
  const t = setTimeout(() => ac.abort(), TIMEOUT_MS);
  try {
    const r = await fetch(url, { signal: ac.signal, headers: { accept: "application/json" } });
    if (r.status === 429) throw new Error("rate_limited");
    if (!r.ok) throw new Error(`http_${r.status}`);
    return await r.json();
  } finally {
    clearTimeout(t);
  }
}

// ── PRIMARY: BlockCypher ltc/main ──
// Optional token raises limits + gives accounting. Batch multiple addresses with ';' (NOT ',').
async function fromBlockCypher(address: string, token?: string): Promise<AddrStatus> {
  const q = token ? `?token=${token}` : "";
  const bal = await fetchJson(`https://api.blockcypher.com/v1/ltc/main/addrs/${address}/balance${q}`);
  if (!bal.total_received) {
    return { receivedLitoshi: 0, pendingLitoshi: bal.unconfirmed_balance ?? 0, maxConfirmations: 0 };
  }
  // Only fetch tx detail (confirmations) once funds appear.
  const full = await fetchJson(`https://api.blockcypher.com/v1/ltc/main/addrs/${address}${q}`);
  const refs: any[] = full.txrefs ?? [];
  const incoming = refs.filter((t) => (t.tx_output_n ?? -1) >= 0 && t.value > 0);
  const maxConf = incoming.reduce((m, t) => Math.max(m, t.confirmations ?? 0), 0);
  return {
    receivedLitoshi: bal.total_received,
    pendingLitoshi: bal.unconfirmed_balance ?? 0,
    maxConfirmations: maxConf,
    txid: incoming[0]?.tx_hash,
  };
}

// ── FALLBACK: litecoinspace.org (mempool.space / Esplora fork) ──
async function fromMempoolStyle(address: string): Promise<AddrStatus> {
  const base = "https://litecoinspace.org/api";
  const [info, tip] = await Promise.all([
    fetchJson(`${base}/address/${address}`),
    fetchJson(`${base}/blocks/tip/height`),
  ]);
  const received = info.chain_stats?.funded_txo_sum ?? 0; // per-order address never spends
  const pending = info.mempool_stats?.funded_txo_sum ?? 0;
  if (!received && !pending) return { receivedLitoshi: 0, pendingLitoshi: 0, maxConfirmations: 0 };
  const txs: any[] = await fetchJson(`${base}/address/${address}/txs`);
  let maxConf = 0;
  let txid: string | undefined;
  for (const t of txs) {
    const paysUs = (t.vout ?? []).some((o: any) => o.scriptpubkey_address === address);
    if (!paysUs) continue;
    if (t.status?.confirmed) {
      const conf = Number(tip) - t.status.block_height + 1;
      if (conf > maxConf) {
        maxConf = conf;
        txid = t.txid;
      }
    } else if (!txid) {
      txid = t.txid; // seen but unconfirmed
    }
  }
  return { receivedLitoshi: received, pendingLitoshi: pending, maxConfirmations: maxConf, txid };
}

export async function getAddrStatus(address: string, blockcypherToken?: string): Promise<AddrStatus> {
  try {
    return await fromBlockCypher(address, blockcypherToken);
  } catch {
    return await fromMempoolStyle(address); // independent failover (won't share an outage)
  }
}

/** Pure decision helper — easy to unit test without network. */
export function paymentDecision(
  status: AddrStatus,
  expectedLitoshi: number,
  requiredConfirmations: number,
  toleranceLitoshi: number
): "paid" | "underpaid" | "waiting" {
  const enoughAmt = status.receivedLitoshi >= expectedLitoshi - toleranceLitoshi;
  const enoughConf = status.maxConfirmations >= requiredConfirmations;
  if (enoughAmt && enoughConf) return "paid";
  if (status.receivedLitoshi > 0 && !enoughAmt) return "underpaid";
  return "waiting"; // nothing yet, or seen-but-unconfirmed
}
