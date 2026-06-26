const fs = require("fs");
const path = require("path");

const ADDS = {
  en: {
    confirmRevokeOthersMsg: "All other devices will be signed out immediately.",
    confirmRevokeOneMsg: "This device will be signed out immediately.",
  },
  de: {
    confirmRevokeOthersMsg: "Alle anderen Geraete werden sofort abgemeldet.",
    confirmRevokeOneMsg: "Dieses Geraet wird sofort abgemeldet.",
  },
  vi: {
    confirmRevokeOthersMsg: "Tat ca thiet bi khac se bi dang xuat ngay lap tuc.",
    confirmRevokeOneMsg: "Thiet bi nay se bi dang xuat ngay lap tuc.",
  },
  zh: {
    confirmRevokeOthersMsg: "All other devices will be signed out immediately.",
    confirmRevokeOneMsg: "This device will be signed out immediately.",
  },
  es: {
    confirmRevokeOthersMsg: "Todos los demas dispositivos seran desconectados inmediatamente.",
    confirmRevokeOneMsg: "Este dispositivo sera desconectado inmediatamente.",
  },
};

const root = path.join(__dirname, "..", "frontend", "src", "i18n", "locales");

for (const [loc, ads] of Object.entries(ADDS)) {
  const file = path.join(root, loc + ".json");
  const j = JSON.parse(fs.readFileSync(file, "utf8"));
  j.storefront = j.storefront || {};
  j.storefront.sessions = j.storefront.sessions || {};
  Object.assign(j.storefront.sessions, ads);
  fs.writeFileSync(file, JSON.stringify(j, null, 2) + "\n");
  console.log(loc, "ok");
}