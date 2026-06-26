// @ts-check

import node from "@astrojs/node";
import react from "@astrojs/react";
import sitemap from "@astrojs/sitemap";
import { defineConfig } from "astro/config";

const SITE = process.env.PUBLIC_SITE_URL || "http://localhost:4321";

// Dev-only proxy target for /api/* — keeps browser fetch('/api/...')
// same-origin when running `bun run dev` so the CSRF Origin gate matches.
// Production routes /api/* via Caddy and ignores this entirely.
const DEV_API_TARGET = process.env.PUBLIC_API_ORIGIN_DEV || "http://localhost:3000";

const EXCLUDE_FROM_SITEMAP = new RegExp(
  "/(admin|checkout|orders|login|register|api)\\b",
);

// https://astro.build/config
export default defineConfig({
  site: SITE,
  output: "server",
  adapter: node({ mode: "standalone" }),
  integrations: [
    react(),
    sitemap({
      filter: (page) => !EXCLUDE_FROM_SITEMAP.test(page),
    }),
  ],
  vite: {
    optimizeDeps: {
      include: ["react", "react-dom", "react-dom/client", "react/jsx-runtime"],
    },
    resolve: {
      dedupe: ["react", "react-dom"],
    },
    server: {
      proxy: {
        "/api": {
          target: DEV_API_TARGET,
          changeOrigin: false,
        },
      },
    },
  },
});