# nexora-updater — host-side controller that orchestrates image swaps.
#
# Runs in its own tiny container. Mounts the Docker socket (read-write) and
# the nexora-db volume (read-only) so it can:
#   1) Snapshot the DB volume to a backup tar before pulling.
#   2) docker pull the new image.
#   3) docker compose up -d to swap.
#   4) Healthcheck the new backend; rollback if it fails.
#
# Exposes a Unix socket at /var/run/nexora-updater.sock (bind-mounted into
# the backend container). Only the backend process can talk to it because
# the socket is mode 0600 owned by the backend uid.
FROM oven/bun:1-alpine
RUN apk add --no-cache docker-cli docker-compose curl
WORKDIR /updater
COPY package.json ./
RUN bun install --production
COPY server.ts .
ENV PORT=0
ENV SOCKET_PATH=/var/run/nexora-updater.sock
ENV BACKUP_DIR=/var/backups/nexora
ENV COMPOSE_FILE=/nexora/docker-compose.yml
ENV NEXORA_VOLUME=nexora-db
CMD ["bun", "server.ts"]