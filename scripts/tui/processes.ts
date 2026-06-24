import { type Subprocess, spawn } from "bun";

export type Status = "stopped" | "starting" | "ready" | "error";
export type LogLevel = "info" | "warn" | "error" | "ok" | "debug";
export type LogLine = { ts: number; level: LogLevel; text: string };

export type ProcHandle = {
  proc: Subprocess | null;
  kill: () => void;
};

const ANSI_RE = /\x1b\[[0-9;]*[a-zA-Z]/g;
const NL = String.fromCharCode(10);

// Drop noisy lines unrelated to the app — proxy/MITM cert warnings injected
// by local network shims (9router, mitmproxy, corporate proxies) when Bun
// loads system CAs. They cause no harm and only clutter the TUI.
const NOISE_PATTERNS: RegExp[] = [
  /ignoring extra certs from .+rootCA\.crt/i,
  /error:10000002:SSL routines:OPENSSL_internal:system library/i,
  /9router\\mitm/i,
];

function isNoiseWarning(line: string): boolean {
  for (const re of NOISE_PATTERNS) {
    if (re.test(line)) return true;
  }
  return false;
}

// Phan loai mot dong log thanh level. Stderr mac dinh la "warn" thay vi "info"
// vi noi do thuong cho cac thong bao quan trong hon.
function detectLevel(text: string, fromStderr: boolean): LogLevel {
  if (/\b(error|exception|fail(ed|ure)?|fatal|panic|throw|crash)\b/i.test(text)) return "error";
  if (/✓|✔|ready|listening|started|running|compiled|connected|success(ful)?\b/i.test(text))
    return "ok";
  if (/\b(warn(ing)?|deprecated|skip(ping)?)\b/i.test(text)) return "warn";
  if (/\b(debug|trace|verbose)\b/i.test(text)) return "debug";
  return fromStderr ? "warn" : "info";
}

export function startProcess(opts: {
  cmd: string[];
  cwd?: string;
  readyPattern?: RegExp;
  onStatus: (s: Status) => void;
  onLog: (line: LogLine) => void;
}): ProcHandle {
  opts.onStatus("starting");
  let proc: Subprocess | null = null;
  try {
    proc = spawn({
      cmd: opts.cmd,
      cwd: opts.cwd,
      stdout: "pipe",
      stderr: "pipe",
      env: { ...process.env, FORCE_COLOR: "0" },
    });
  } catch (e) {
    opts.onStatus("error");
    opts.onLog({ ts: Date.now(), level: "error", text: `spawn failed: ${(e as Error).message}` });
    return { proc: null, kill: () => {} };
  }

  const ready = opts.readyPattern;
  let isReady = false;

  const pipe = async (stream: ReadableStream<Uint8Array> | null, fromStderr: boolean) => {
    if (!stream) return;
    const reader = stream.getReader();
    const dec = new TextDecoder();
    let buf = "";
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buf += dec.decode(value, { stream: true });
      let idx = buf.indexOf(NL);
      while (idx !== -1) {
        const raw = buf.slice(0, idx);
        buf = buf.slice(idx + 1);
        const line = raw.replace(ANSI_RE, "").replace(/\r$/, "");
        if (line.length > 0 && !isNoiseWarning(line)) {
          const level = detectLevel(line, fromStderr);
          opts.onLog({ ts: Date.now(), level, text: line });
          if (!isReady && ready && ready.test(line)) {
            isReady = true;
            opts.onStatus("ready");
          }
        }
        idx = buf.indexOf(NL);
      }
    }
  };

  pipe(proc.stdout as any, false).catch(() => {});
  pipe(proc.stderr as any, true).catch(() => {});

  proc.exited.then((code) => {
    opts.onStatus(code === 0 ? "stopped" : "error");
  });

  return {
    proc,
    kill: () => {
      try {
        proc?.kill();
      } catch {}
    },
  };
}
