/**
 * Build the markdown body SellAuth shows the customer after payment.
 * Same string is also emailed by SellAuth, so keep it plain-text friendly:
 * no HTML, no fancy unicode that breaks in mail clients.
 */
import { type Tier, tierLabel } from "./tier.ts";

interface DeliveryInput {
  invoiceId: string;
  email: string;
  tier: Tier;
  licenseJson: string; // already pretty-printed JSON
  installUrl: string;
  supportEmail: string;
  supportDiscord?: string;
}

export function buildDeliveryMarkdown(i: DeliveryInput): string {
  const lts = i.tier === "lts";
  const support = [
    i.supportDiscord ? `- Discord: ${i.supportDiscord}` : null,
    `- Email: ${i.supportEmail}`,
  ]
    .filter(Boolean)
    .join("\n");

  return `# Welcome to Nexora

Your invoice id: \`${i.invoiceId}\`
Tier: **${tierLabel(i.tier)}**${lts ? " (frozen build, no updates)" : ""}

---

## 1. Save your license file

Save the JSON below to a file named \`nexora.license\`. You'll drop it next
to your install in step 3.

\`\`\`json
${i.licenseJson}
\`\`\`

## 2. Install on your server

SSH into your VPS (Ubuntu / Debian recommended), then run:

\`\`\`bash
curl -fsSL ${i.installUrl} | bash
\`\`\`

When prompted, paste your invoice id: \`${i.invoiceId}\`

Your per-invoice Docker image is being built right now — first \`docker pull\`
may take 1-3 minutes. The script waits for the API and walks you through
the rest.

## 3. After install completes

1. Move the saved \`nexora.license\` file into the install directory (next
   to \`docker-compose.yml\`).
2. Restart: \`docker compose restart\`.
3. Open \`http(s)://your-domain/setup\` in a browser to create the admin
   account and paste your Litecoin xpub.

## Support

${support}

Keep this email — you'll need the license file and invoice id forever.
`;
}