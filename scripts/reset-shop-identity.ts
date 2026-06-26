// Reset the storefront identity values that often get polluted by test
// fixtures (store_name, store_handle, tagline). Uses the backend's settings
// layer so encrypted columns are written through the same crypto path.

import { setSetting } from "../backend/src/lib/settings.ts";

const DEFAULTS: Record<string, string> = {
  store_name: "Nexora",
  store_handle: "nexora",
  store_tagline: "Digital goods, delivered instantly.",
  store_description: "Premium digital goods storefront powered by Nexora.",
};

for (const [key, val] of Object.entries(DEFAULTS)) {
  await setSetting(key, val);
  console.log("set", key, "→", val);
}