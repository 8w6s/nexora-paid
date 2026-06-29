/**
 * Build the delivery body SellAuth shows the customer after payment.
 *
 * SellAuth splits the body on BLANK LINES and renders each chunk as a
 * separate copy-able tile. To get ONE tile the buyer can take in one
 * action, we:
 *   - collapse the license JSON to a single line (preserves signature),
 *   - emit every section on contiguous lines (no blank-line separators).
 * That gives the buyer a single block they can copy, with section
 * markers ("--- STEP N:") that the eye still parses.
 */
import { type Tier, tierLabel } from "./tier.ts";

interface DeliveryInput {
  invoiceId: string;
  email: string;
  tier: Tier;
  licenseJson: string;
  installShUrl: string;
  installPs1Url: string;
  supportEmail: string;
  supportDiscord?: string;
}

export function buildDeliveryMarkdown(i: DeliveryInput): string {
  const lts = i.tier === "lts";
  // Collapse all whitespace runs (newlines, indents) into a single space.
  // The Ed25519 signature is over JSON.stringify(payload) WITH whatever
  // serialization the Worker just produced — the file the buyer saves
  // must match that exact byte sequence. We serialized the JSON as
  // pretty-printed in the Worker; the verifier calls JSON.parse then
  // re-stringifies, so any valid whitespace round-trips. Single-line is
  // therefore safe.
  const oneLineLicense = i.licenseJson.replace(/\s+/g, " ").trim();
  const supportLine = i.supportDiscord
    ? `Support: ${i.supportEmail} | Discord: ${i.supportDiscord}`
    : `Support: ${i.supportEmail}`;

  return [
    `Nexora delivery — invoice ${i.invoiceId} — ${tierLabel(i.tier)}${lts ? " (frozen)" : ""}`,
    `Email registered: ${i.email}`,
    `--- STEP 1: save the line below as a file named 'nexora.license' (keep it byte-exact):`,
    oneLineLicense,
    `--- STEP 2 (Linux/macOS/WSL): curl -fsSL ${i.installShUrl} | bash`,
    `--- STEP 2 (Windows PowerShell as Admin): iwr -useb ${i.installPs1Url} | iex`,
    `--- STEP 2: when prompted, paste your invoice id: ${i.invoiceId}`,
    `--- STEP 3: drop nexora.license next to docker-compose.yml, then run: docker compose restart`,
    `--- STEP 3: open http(s)://your-domain/setup to create admin + paste LTC xpub`,
    supportLine,
    `Keep this email — you need the JSON above and the invoice id forever.`,
  ].join("\n");
}