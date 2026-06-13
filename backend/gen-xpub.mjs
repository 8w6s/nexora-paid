import { HDKey } from "@scure/bip32";

const seed = new Uint8Array(64);
for (let i = 0; i < 64; i++) seed[i] = (i * 7 + 3) & 0xff;
const v = { public: 0x019da462, private: 0x019d9cfe };
const m = HDKey.fromMasterSeed(seed, v);
const account = "m" + "/44" + "'/2'/0'";
console.log(m.derive(account).publicExtendedKey);
