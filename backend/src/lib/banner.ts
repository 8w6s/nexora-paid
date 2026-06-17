import { NEXORA_VERSION } from "./version.ts";

export function printBootBanner(): void {
  const port = Bun.env.PORT ?? 3000;
  const origin = Bun.env.PUBLIC_ORIGIN ?? `http://localhost:${port}`;

  const bold = "\x1b[1m";
  const green = "\x1b[32m";
  const cyan = "\x1b[36m";
  const yellow = "\x1b[33m";
  const red = "\x1b[31m";
  const dim = "\x1b[90m";
  const reset = "\x1b[0m";

  const license = (globalThis as any).__nexora_license;
  const plugins = (globalThis as any).__nexora_plugins ?? [];
  const adminEmail = (globalThis as any).__nexora_admin_email;

  let licenseLine = `${yellow}missing (Free Tier)${reset}`;
  if (license) {
    if (license.valid) {
      licenseLine = `${green}valid (${license.email})${reset}`;
    } else {
      licenseLine = `${red}invalid (${license.reason})${reset}`;
    }
  }

  const loadedPlugins = plugins.filter((p: any) => p.loaded);
  let pluginsLine = `${dim}none${reset}`;
  if (loadedPlugins.length > 0) {
    pluginsLine = `${green}${loadedPlugins.length} loaded${reset}`;
  }

  const adminLine = adminEmail
    ? `${green}ready (${adminEmail})${reset}`
    : `${dim}not bootstrapped${reset}`;

  console.log("");
  console.log(`  ${bold}${cyan}⚡ NEXORA API${reset} ${dim}v${NEXORA_VERSION}${reset}`);
  console.log("");
  console.log(
    `  ${bold}➜${reset}  ${bold}Local:${reset}    ${cyan}http://localhost:${port}${reset}`,
  );
  console.log(`  ${bold}➜${reset}  ${bold}CORS:${reset}     ${cyan}${origin}${reset}`);
  console.log("");
  console.log(`  ${bold}🔑 License:${reset}  ${licenseLine}`);
  console.log(`  ${bold}🔌 Plugins:${reset}  ${pluginsLine}`);

  for (const p of loadedPlugins) {
    console.log(`     ${dim}•${reset} ${p.id}@${p.version} ${dim}— ${p.description}${reset}`);
  }

  console.log("");
  console.log(`  ${bold}👤 Admin:${reset}    ${adminLine}`);
  console.log(`  ${bold}👀 Watcher:${reset}  ${green}running${reset} ${dim}(30s interval)${reset}`);
  console.log("");
}
