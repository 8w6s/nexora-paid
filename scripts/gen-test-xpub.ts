import { HDKey } from "../backend/node_modules/@scure/bip32/lib/esm/index.js";
import { randomBytes } from "crypto";

const seed = randomBytes(32);
const v = { public: 0x019da462, private: 0x019d9cfe }; // Ltub
const master = HDKey.fromMasterSeed(new Uint8Array(seed), v);
const account = master.derive("m/44'/2'/0'");
console.log(account.publicExtendedKey);