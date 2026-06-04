import { HDKey } from "@scure/bip32";
import { deriveReceiveAddress, detectFlavor, validateXpub } from "./hd.ts";

// Fixed seed (NOT a real wallet — test only).
const seed = new Uint8Array(64);
for (let i = 0; i < 64; i++) seed[i] = (i * 7 + 3) & 0xff;

type Case = { name: string; version: { public: number; private: number }; account: string; prefixCheck: RegExp };
const cases: Case[] = [
  { name: "Ltub/P2PKH", version: { public: 0x019da462, private: 0x019d9cfe }, account: "m/44'/2'/0'", prefixCheck: /^L/ },
  { name: "Mtub/P2SH", version: { public: 0x01b26ef6, private: 0x01b26792 }, account: "m/49'/2'/0'", prefixCheck: /^M/ },
  { name: "zpub/bech32", version: { public: 0x04b24746, private: 0x04b2430c }, account: "m/84'/2'/0'", prefixCheck: /^ltc1/ },
];

let pass = 0, fail = 0;
const ok = (label: string, cond: boolean, extra = "") => {
  if (cond) { pass++; console.log(`  ✓ ${label} ${extra}`); }
  else { fail++; console.log(`  ✗ ${label} ${extra}`); }
};

for (const c of cases) {
  console.log(`\n[${c.name}]`);
  const master = HDKey.fromMasterSeed(seed, c.version);
  const account = master.derive(c.account);
  const xpub = account.publicExtendedKey;

  // prefix of exported account xpub matches the version
  ok("account xpub parses", detectFlavor(xpub) !== undefined, `prefix=${xpub.slice(0, 4)}`);

  // derive 3 addresses
  const a0 = deriveReceiveAddress(xpub, 0);
  const a1 = deriveReceiveAddress(xpub, 1);
  const a0b = deriveReceiveAddress(xpub, 0);
  ok("address format", c.prefixCheck.test(a0), `addr0=${a0}`);
  ok("deterministic (same index → same addr)", a0 === a0b);
  ok("distinct (different index → different addr)", a0 !== a1, `addr1=${a1}`);

  // cross-check: public-only derivation == full-key derivation at m/0/0
  const fullChild = account.deriveChild(0).deriveChild(0);
  const pubOnly = HDKey.fromExtendedKey(xpub, c.version).deriveChild(0).deriveChild(0);
  ok("public-only pubkey == full-key pubkey", Buffer.from(fullChild.publicKey!).toString("hex") === Buffer.from(pubOnly.publicKey!).toString("hex"));

  // validateXpub
  const v = validateXpub(xpub);
  ok("validateXpub ok", v.ok === true, v.ok ? `type=${v.type}` : (v as any).error);
}

// reject garbage
const bad = validateXpub("not-a-key");
ok("rejects garbage xpub", bad.ok === false);

console.log(`\n=== ${pass} passed, ${fail} failed ===`);
if (fail > 0) process.exit(1);
