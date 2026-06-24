import { NEXORA_VERSION } from "./version.ts";

export type LicenseInfo = { valid: true; email: string } | { valid: false; reason: string };

export type PluginRecord = {
  id: string;
  version: string;
  description: string;
  loaded: boolean;
  reason?: string;
};

/**
 * Boot-time integrity verdict surfaced from `lib/integrity-state.ts`.
 * Banner-local shape so this module stays decoupled from the verifier
 * internals — caller maps `IntegrityResult` → `IntegrityInfo` at the
 * boot path (mirrors the LicenseInfo / PluginRecord decoupling above).
 */
export type IntegrityInfo =
  | { ok: true; skipped: true }
  | { ok: true; skipped: false; checked: number; buildId?: string }
  | { ok: false; reason: string; degraded: boolean; mismatchCount: number; buildId?: string };

/**
 * Pretty boot banner. Inputs are explicit args, not globalThis reads, so a
 * future caller (test harness, alt bootstrap) can render the banner without
 * a side-channel. Pre-audit the banner reached into `globalThis.__nexora_*`
 * which forced load order coupling and made refactors silently break.
 *
 * In production the licensee email is redacted to `***@domain` before
 * console.log so log aggregators (PM2, Docker, hosted log shippers) don't
 * permanently capture a long-lived plaintext email next to your boot logs.
 */
export function printBootBanner(
  opts: {
    license?: LicenseInfo | null;
    plugins?: PluginRecord[];
    adminEmail?: string | null;
    integrity?: IntegrityInfo | null;
  } = {},
): void {
  const port = Bun.env.PORT ?? 3000;
  const origin = Bun.env.PUBLIC_ORIGIN ?? `http://localhost:${port}`;

  const bold = "\x1b[1m";
  const green = "\x1b[32m";
  const cyan = "\x1b[36m";
  const yellow = "\x1b[33m";
  const red = "\x1b[31m";
  const dim = "\x1b[90m";
  const reset = "\x1b[0m";

  const license = opts.license ?? null;
  const plugins = opts.plugins ?? [];
  const adminEmail = opts.adminEmail ?? null;
  const isProd = Bun.env.NODE_ENV === "production";

  let licenseLine = `${yellow}missing (Free Tier)${reset}`;
  if (license) {
    if (license.valid) {
      const display = isProd ? redactEmail(license.email) : license.email;
      licenseLine = `${green}valid (${display})${reset}`;
    } else {
      licenseLine = `${red}invalid (${license.reason})${reset}`;
    }
  }

  const integrity = opts.integrity ?? null;
  let integrityLine = `${dim}not checked${reset}`;
  if (integrity) {
    if (integrity.ok && integrity.skipped) {
      integrityLine = `${yellow}skipped${reset} ${dim}(dev mode)${reset}`;
    } else if (integrity.ok) {
      const buildPart = integrity.buildId ? ` ${dim}build=${integrity.buildId}${reset}` : "";
      integrityLine = `${green}OK${reset}${buildPart} ${dim}(${integrity.checked} files)${reset}`;
    } else if (!integrity.degraded) {
      // Manifest absent in dev — verifier reported fail but our policy
      // tolerates it. Surface as yellow, not red, so devs aren't alarmed.
      integrityLine = `${yellow}${integrity.reason}${reset} ${dim}(dev tolerated)${reset}`;
    } else {
      const detail =
        integrity.mismatchCount > 0 ? ` ${dim}(${integrity.mismatchCount} mismatches)${reset}` : "";
      integrityLine = `${red}DEGRADED — ${integrity.reason}${reset}${detail}`;
    }
  }

  const loadedPlugins = plugins.filter((p) => p.loaded);
  let pluginsLine = `${dim}none${reset}`;
  if (loadedPlugins.length > 0) {
    pluginsLine = `${green}${loadedPlugins.length} loaded${reset}`;
  }

  const adminDisplay = adminEmail ? (isProd ? redactEmail(adminEmail) : adminEmail) : null;
  const adminLine = adminDisplay
    ? `${green}ready (${adminDisplay})${reset}`
    : `${dim}not bootstrapped${reset}`;

  console.log("");
  console.log(`  ${bold}${cyan}⚡ NEXORA API${reset} ${dim}v${NEXORA_VERSION}${reset}`);
  console.log("");
  console.log(
    `  ${bold}➜${reset}  ${bold}Local:${reset}    ${cyan}http://localhost:${port}${reset}`,
  );
  console.log(`  ${bold}➜${reset}  ${bold}CORS:${reset}     ${cyan}${origin}${reset}`);
  console.log("");
  console.log(`  ${bold}🔑 License:${reset}    ${licenseLine}`);
  console.log(`  ${bold}🛡 Integrity:${reset}  ${integrityLine}`);
  console.log(`  ${bold}🔌 Plugins:${reset}    ${pluginsLine}`);

  for (const p of loadedPlugins) {
    console.log(`     ${dim}•${reset} ${p.id}@${p.version} ${dim}— ${p.description}${reset}`);
  }

  console.log("");
  console.log(`  ${bold}👤 Admin:${reset}    ${adminLine}`);
  console.log(`  ${bold}👀 Watcher:${reset}  ${green}running${reset} ${dim}(30s interval)${reset}`);
  console.log("");
}

function redactEmail(e: string): string {
  const at = e.indexOf("@");
  if (at <= 0) return "***";
  return `***@${e.slice(at + 1)}`;
}
