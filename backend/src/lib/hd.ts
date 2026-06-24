import { ripemd160 } from "@noble/hashes/legacy.js";
import { sha256 } from "@noble/hashes/sha2.js";
import { base58check, bech32 } from "@scure/base";
import { HDKey } from "@scure/bip32";

/**
 * Derive Litecoin receive addresses from an extended PUBLIC key (xpub), no private key.
 * Pure-JS @scure stack (Bun-friendly, no WASM). @scure/bip32 derives keys only; we encode
 * the address ourselves per script type implied by the key prefix.
 *
 * Litecoin mainnet params: P2PKH version 0x30 (L…), P2SH 0x32 (M…), bech32 HRP "ltc" (ltc1…).
 */

const b58c = base58check(sha256); // checksummed Base58 (double-sha256)
const hash160 = (b: Uint8Array) => ripemd160(sha256(b));

const LTC = { p2pkh: 0x30, p2sh: 0x32, hrp: "ltc" } as const;

export type Flavor = "p2pkh" | "p2sh-p2wpkh" | "p2wpkh";

// SLIP-0132 version pairs, keyed by the accepted 4-char prefix. The prefix decides BOTH the
// version bytes to parse with AND the address type to emit.
//  - zpub is the GENERIC BIP84 prefix (Bitcoin's), NOT a Litecoin-specific value; many LTC
//    wallets reuse it for native segwit. Pin to the wallet's actual prefix in production.
const PREFIX: Record<string, { v: { private: number; public: number }; type: Flavor }> = {
  Ltub: { v: { public: 0x019da462, private: 0x019d9cfe }, type: "p2pkh" }, // BIP44 (LTC)
  xpub: { v: { public: 0x0488b21e, private: 0x0488ade4 }, type: "p2pkh" }, // BIP44 (BTC-style)
  Mtub: { v: { public: 0x01b26ef6, private: 0x01b26792 }, type: "p2sh-p2wpkh" }, // BIP49 (LTC)
  ypub: { v: { public: 0x049d7cb2, private: 0x049d7878 }, type: "p2sh-p2wpkh" }, // BIP49 (BTC-style)
  zpub: { v: { public: 0x04b24746, private: 0x04b2430c }, type: "p2wpkh" }, // BIP84 (generic)
};

// Unambiguously Bitcoin prefixes. xpub/ypub are BIP44/BIP49 BTC versions;
// pasting them here would derive technically-valid LTC addresses from a
// Bitcoin key, sending customer LTC to a wallet the merchant cannot see in
// their normal tooling AND letting anyone else holding that BTC xpub
// (Electrum server, hw-vendor logs, watch-only sharer) sweep the funds.
// zpub stays allowed because it is the de-facto BIP84 prefix many LTC
// wallets emit for native SegWit; gating it would break real users.
const NON_LTC_PREFIXES = new Set(["xpub", "ypub"]);

export function detectFlavor(xpub: string): {
  v: { private: number; public: number };
  type: Flavor;
} {
  const prefix = xpub.slice(0, 4);
  const cfg = PREFIX[prefix];
  if (!cfg) throw new Error(`Unsupported extended key prefix: ${prefix}`);
  if (NON_LTC_PREFIXES.has(prefix)) {
    const allow = (process.env.NEXORA_ALLOW_CROSS_CHAIN_XPUB ?? "").toLowerCase() === "true";
    if (!allow) {
      throw new Error(
        `Refusing ${prefix}: that's a Bitcoin extended key. Paste an Ltub/Mtub/zpub from a Litecoin wallet, or set NEXORA_ALLOW_CROSS_CHAIN_XPUB=true to override (you almost certainly do not want to).`,
      );
    }
  }
  return cfg;
}

function encodeAddress(pubkey: Uint8Array, type: Flavor): string {
  const pkh = hash160(pubkey);
  if (type === "p2pkh") {
    return b58c.encode(Uint8Array.from([LTC.p2pkh, ...pkh])); // L…
  }
  if (type === "p2sh-p2wpkh") {
    const redeem = Uint8Array.from([0x00, 0x14, ...pkh]); // OP_0 PUSH20 <pkh>
    return b58c.encode(Uint8Array.from([LTC.p2sh, ...hash160(redeem)])); // M…
  }
  return bech32.encode(LTC.hrp, [0, ...bech32.toWords(pkh)]); // ltc1… (witness v0)
}

// Admin pastes the ACCOUNT xpub (depth 3). Derive the external receive chain m/0/index.
export function deriveReceiveAddress(accountXpub: string, index: number): string {
  const { v, type } = detectFlavor(accountXpub);
  const hd = HDKey.fromExtendedKey(accountXpub, v); // public-only is fine
  const child = hd.deriveChild(0).deriveChild(index); // m/0/i (non-hardened)
  if (!child.publicKey) throw new Error("No public key on derived node");
  return encodeAddress(child.publicKey, type);
}

// Validate a pasted xpub: must parse and produce a valid index-0 address.
export function validateXpub(
  xpub: string,
): { ok: true; type: Flavor; sample: string } | { ok: false; error: string } {
  try {
    const { type } = detectFlavor(xpub);
    const sample = deriveReceiveAddress(xpub, 0);
    return { ok: true, type, sample };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}
