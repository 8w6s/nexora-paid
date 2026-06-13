// @ts-check

import node from "@astrojs/node";
import react from "@astrojs/react";
import sitemap from "@astrojs/sitemap";
import { defineConfig } from "astro/config";

const SITE = process.env.PUBLIC_SITE_URL || "http://localhost:4321";

// https://astro.build/config
export default defineConfig({
  site: SITE,
  output: "server", // SSR (product/catalog dynamic; no rebuild on new products)
  adapter: node({ mode: "standalone" }),
  integrations: [
    react(),
    sitemap({
      filter: (page) => !/\/(admin|checkout|orders|login|register|api)\b/.test(page),
    }),
  ],
  vite: {
    optimizeDeps: {
      include: ["react", "react-dom", "react-dom/client", "react/jsx-runtime"],
    },
    resolve: {
      dedupe: ["react", "react-dom"],
    },
  },
});
