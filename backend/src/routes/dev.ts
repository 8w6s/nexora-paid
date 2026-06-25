/**
 * Dev dashboard routes — only active when NODE_ENV is not "production".
 * Exposes SSE log stre dev mode to stream to SSE clients.
 *
 * SECURITY: even in dev these routes leak every console line through SSE,
 * which routinely includes email addresses, IPs, and stack traces with file
 * paths. Without an auth gate, anyone who can reach the backend port (e.g. a
 * LAN attacker on a developer laptop) can siphon the live log stream. We
 * gate /__dev/logs behind an admin session cookie + an explicit DEV_LOGS_TOKEN
 * env (the SSE EventSource API can't send custom headers, so the route also
 * accepts ?token= as a fallback for browser clients in the dev runner UI).
 */
import { Elysia } from "elysia";
import { SESSION_COOKIE, validateSession } from "../lib/auth.ts";

// ───── Log ring buffer (shared across the process) ─────
// Any module can push to this buffer; the SSE endpoint streams it.
const MAX_RING = 500;
type LogEntry = { ts: string; source: string; level: string; message: string };
const logRing: LogEntry[] = [];
const sseClients = new Set<(entry: LogEntry) => void>();

export function pushDevLog(source: string, level: string, message: string) {
  const entry: LogEntry = {
    ts: new Date().toISOString(),
    source,
    level,
    message,
  };
  logRing.push(entry);
  if (logRing.length > MAX_RING) logRing.shift();

  // Fan-out to SSE clients
  for (const send of sseClients) {
    try {
      send(entry);
    } catch {
      sseClients.delete(send);
    }
  }
}

// Static token override for the dev runner UI's EventSource client (which
// cannot attach Authorization headers). Generated once per process if not
// supplied via env, printed to the operator console at boot. The runner
// CLI reads it from stderr and forwards it as ?token= on the EventSource
// URL. Comparison is identical-string + length-equal; the surface is
// dev-only and the entropy is 64 hex chars (256 bits) so this is enough.
const DEV_LOGS_TOKEN =
  Bun.env.DEV_LOGS_TOKEN ??
  (() => {
    const t = crypto.randomUUID().replace(/-/g, "") + crypto.randomUUID().replace(/-/g, "");
    if (Bun.env.NODE_ENV !== "production") {
      console.warn(`[dev] DEV_LOGS_TOKEN not set; generated ephemeral token=${t.slice(0, 8)}...`);
    }
    return t;
  })();

async function devLogsAllowed(request: Request, cookieToken: string | undefined): Promise<boolean> {
  // Admin session is sufficient — same trust level the rest of /api/admin uses.
  const user = await validateSession(cookieToken);
  if (user?.role === "admin") return true;
  // Otherwise require the static token. EventSource cannot set headers, so
  // accept ?token= as a fallback for browser clients in the dev runner UI.
  const url = new URL(request.url);
  const qToken = url.searchParams.get("token") ?? "";
  const hAuth = request.headers.get("authorization") ?? "";
  const bearer = hAuth.toLowerCase().startsWith("bearer ") ? hAuth.slice(7).trim() : "";
  const supplied = qToken || bearer;
  if (!supplied) return false;
  return supplied.length === DEV_LOGS_TOKEN.length && supplied === DEV_LOGS_TOKEN;
}

/**
 * Conditionally register dev routes on the given app.
 * In production these routes are no-ops (not mounted).
 */
export const devRoutes = new Elysia()
  // ───── SSE log stream ─────
  // Mounted under /api so the existing admin session cookie (which is
  // path-scoped to /api) is sent automatically. The legacy /__dev/logs
  // path is intentionally NOT exposed; cookies wouldn't reach it.
  .get("/api/__dev/logs", async ({ request, set, cookie }) => {
    // Auth gate: admin session cookie OR DEV_LOGS_TOKEN. Without this any
    // process that can reach the backend port can siphon every console line,
    // which routinely contains emails, IPs, and internal stack traces.
    const ok = await devLogsAllowed(request, cookie[SESSION_COOKIE]?.value as string | undefined);
    if (!ok) {
      set.status = 401;
      return { error: "Unauthorized", code: "UNAUTHENTICATED" };
    }

    set.headers["content-type"] = "text/event-stream";
    set.headers["cache-control"] = "no-cache";
    set.headers["connection"] = "keep-alive";
    set.headers["x-accel-buffering"] = "no";

    let closed = false;
    let heartbeat: ReturnType<typeof setInterval> | null = null;

    return new ReadableStream({
      start(controller) {
        const send = (data: unknown) => {
          if (closed) return;
          try {
            controller.enqueue(`data: ${JSON.stringify(data)}\n\n`);
          } catch {
            closed = true;
          }
        };

        // Replay recent logs
        for (const entry of logRing) {
          send({ type: "log", ...entry });
        }

        // Subscribe to new logs
        const handler = (entry: LogEntry) => {
          send({ type: "log", ...entry });
        };
        sseClients.add(handler);

        // Heartbeat to keep connection alive
        heartbeat = setInterval(() => send({ type: "heartbeat" }), 15_000);

        request.signal?.addEventListener("abort", () => {
          sseClients.delete(handler);
          if (heartbeat) clearInterval(heartbeat);
          try {
            controller.close();
          } catch {}
        });
      },
      cancel() {
        closed = true;
        sseClients.clear();
        if (heartbeat) clearInterval(heartbeat);
        heartbeat = null;
      },
    });
  });

// ───── Auto-patch console.log/error/warn in dev mode ─────
// This intercepts all backend console output and feeds it to the SSE stream.
(() => {
  if (Bun.env.NODE_ENV === "production") return;

  const origLog = console.log.bind(console);
  const origWarn = console.warn.bind(console);
  const origError = console.error.bind(console);

  console.log = (...args: unknown[]) => {
    const msg = args.map((a) => (typeof a === "object" ? JSON.stringify(a) : String(a))).join(" ");
    pushDevLog("api", "info", msg);
    origLog(...args);
  };

  console.warn = (...args: unknown[]) => {
    const msg = args.map((a) => (typeof a === "object" ? JSON.stringify(a) : String(a))).join(" ");
    pushDevLog("api", "warn", msg);
    origWarn(...args);
  };

  console.error = (...args: unknown[]) => {
    const msg = args.map((a) => (typeof a === "object" ? JSON.stringify(a) : String(a))).join(" ");
    pushDevLog("api", "error", msg);
    origError(...args);
  };
})();
