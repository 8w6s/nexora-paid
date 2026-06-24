# nexora-fileserver — public-facing version + license verify service.
#
# Tiny stateless Bun service. Public image. Serves:
#   GET  /v1/version?channel=stable  → latest version manifest
#   POST /v1/license/verify          → ed25519 verify + revocation check
#   GET  /v1/changelog/:version      → markdown changelog from GitHub
#
# Backed by a GitHub repo (NEXORA_RELEASES_REPO) containing:
#   versions/stable.json     — { latest, min, imageRepo, imageTag, sha256, ... }
#   revoked.json             — { revoked: ["licenseId1", ...] }
#   changelog/*.md           — per-version notes
FROM oven/bun:1-alpine
WORKDIR /app
COPY package.json ./
RUN bun install --production
COPY server.ts ./
ENV PORT=8080
ENV NODE_ENV=production
EXPOSE 8080
CMD ["bun", "server.ts"]