# Frontend — Astro SSR (@astrojs/node standalone) on Bun
FROM oven/bun:1 AS build
WORKDIR /app
COPY package.json ./
RUN bun install
COPY . .
# PUBLIC_* are baked at build time → pass the production API origin / site URL as build args.
ARG PUBLIC_API_ORIGIN=http://localhost:3000
ARG PUBLIC_SITE_URL=http://localhost:4321
ENV PUBLIC_API_ORIGIN=$PUBLIC_API_ORIGIN
ENV PUBLIC_SITE_URL=$PUBLIC_SITE_URL
RUN bun run build

FROM oven/bun:1 AS run
WORKDIR /app
COPY --from=build /app/dist ./dist
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/package.json ./
ENV HOST=0.0.0.0
ENV PORT=4321
EXPOSE 4321
CMD ["bun", "./dist/server/entry.mjs"]
