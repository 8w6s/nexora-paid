/**
 * Structured JSON logger for Nexora.
 *
 * Design:
 *  - Six levels: trace, debug, info, warn, error, fatal
 *  - JSON output to stdout (production-friendly, log-aggregator-ready)
 *  - Prettified output in dev (NODE_ENV !== "production")
 *  - Always includes timestamp, level, and message
 *  - Extra context fields merged into the log line
 *
 * Usage:
 *   import { logger } from "./lib/logger.ts";
 *   logger.info("watcher tick", { payableOrders: 3 });
 *   logger.warn("rate fetch failed", { source: "kraken", error: e.message });
 */

type Level = "trace" | "debug" | "info" | "warn" | "error" | "fatal";
const LEVEL_PRIO: Record<Level, number> = {
  trace: 0,
  debug: 1,
  info: 2,
  warn: 3,
  error: 4,
  fatal: 5,
};

const MIN_LEVEL: Level =
  (Bun.env.LOG_LEVEL as Level) ?? (Bun.env.NODE_ENV === "production" ? "info" : "debug");

function shouldLog(level: Level): boolean {
  return LEVEL_PRIO[level] >= LEVEL_PRIO[MIN_LEVEL];
}

interface LogEntry {
  ts: string;
  lvl: Level;
  msg: string;
  [key: string]: unknown;
}

function formatEntry(entry: LogEntry): string {
  if (Bun.env.NODE_ENV === "production") {
    return JSON.stringify(entry);
  }
  // Dev: pretty-print with colors
  const colors: Record<Level, string> = {
    trace: "\x1b[90m", // gray
    debug: "\x1b[36m", // cyan
    info: "\x1b[32m", // green
    warn: "\x1b[33m", // yellow
    error: "\x1b[31m", // red
    fatal: "\x1b[35m", // magenta
  };
  const reset = "\x1b[0m";
  const c = colors[entry.lvl];
  const extra = Object.entries(entry).filter(([k]) => k !== "ts" && k !== "lvl" && k !== "msg");
  const extraStr = extra.length
    ? ` ${extra.map(([k, v]) => `${k}=${JSON.stringify(v)}`).join(" ")}`
    : "";
  return `${c}[${entry.ts}] ${entry.lvl.toUpperCase().padEnd(5)}${reset} ${entry.msg}${extraStr}`;
}

function log(level: Level, msg: string, ctx?: Record<string, unknown>): void {
  if (!shouldLog(level)) return;
  const entry: LogEntry = {
    ts: new Date().toISOString(),
    lvl: level,
    msg,
    ...ctx,
  };
  // Route per level so log aggregators that consume stderr separately
  // (e.g. PM2, Docker, Vercel) classify warn/error/fatal as non-stdout.
  // Previously these branches were empty, silently dropping every entry —
  // the worst kind of dead logger because callers think they logged.
  const line = formatEntry(entry);
  if (level === "error" || level === "fatal") {
    console.error(line);
  } else if (level === "warn") {
    console.warn(line);
  } else {
    console.log(line);
  }
}

export const logger = {
  trace: (msg: string, ctx?: Record<string, unknown>) => log("trace", msg, ctx),
  debug: (msg: string, ctx?: Record<string, unknown>) => log("debug", msg, ctx),
  info: (msg: string, ctx?: Record<string, unknown>) => log("info", msg, ctx),
  warn: (msg: string, ctx?: Record<string, unknown>) => log("warn", msg, ctx),
  error: (msg: string, ctx?: Record<string, unknown>) => log("error", msg, ctx),
  fatal: (msg: string, ctx?: Record<string, unknown>) => log("fatal", msg, ctx),
} as const;
