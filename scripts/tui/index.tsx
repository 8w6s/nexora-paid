import { writeFileSync, appendFileSync, readFileSync, existsSync } from "fs";
import { resolve } from "path";

const ERR_LOG = "scripts/tui-error.log";
const CONSOLE_LOG = "scripts/tui-console.log";
try { writeFileSync(ERR_LOG, ""); } catch {}
try { writeFileSync(CONSOLE_LOG, ""); } catch {}

const fmt = (lvl: string, args: unknown[]) =>
  `[${lvl}] ${args
    .map((a) =>
      a instanceof Error ? a.stack ?? a.message : typeof a === "object" ? JSON.stringify(a) : String(a),
    )
    .join(" ")}` + String.fromCharCode(10);

process.on("uncaughtException", (e) => {
  try { appendFileSync(ERR_LOG, `[uncaught] ${(e as Error).stack ?? e}` + String.fromCharCode(10)); } catch {}
});
process.on("unhandledRejection", (e) => {
  try { appendFileSync(ERR_LOG, `[unhandled] ${(e as any)?.stack ?? e}` + String.fromCharCode(10)); } catch {}
});

console.error = (...args: unknown[]) => {
  try { appendFileSync(CONSOLE_LOG, fmt("error", args)); } catch {}
  try { appendFileSync(ERR_LOG, fmt("error", args)); } catch {}
};
console.warn = (...args: unknown[]) => {
  try { appendFileSync(CONSOLE_LOG, fmt("warn", args)); } catch {}
};
console.log = (...args: unknown[]) => {
  try { appendFileSync(CONSOLE_LOG, fmt("log", args)); } catch {}
};

import { render, useKeyboard, useRenderer } from "@opentui/solid";
import { createSignal, onCleanup, onMount, For, Show, createEffect } from "solid-js";
import { TextAttributes } from "@opentui/core";
import { theme } from "./theme";
import { StarryBackground } from "./starry-background";
import { Logo } from "./logo";
import { startProcess, type Status, type ProcHandle, type LogLine, type LogLevel } from "./processes";

const STATUS_FG: Record<Status, typeof theme.ok> = {
  stopped: theme.off,
  starting: theme.warn,
  ready: theme.ok,
  error: theme.err,
};

// U+25CC = ◌ dotted (cho idle/starting), U+25CF = ● filled (cho running).
// Stopped/error: filled mau xam/do.
const STATUS_GLYPH: Record<Status, string> = {
  stopped: "◌",
  starting: "◌",
  ready: "●",
  error: "●",
};

function StatusDot(props: { status: () => Status }) {
  // Online states (starting + ready) nhay deu giua ◌ va ● voi nhip ~1.4s.
  // Stopped/error: glyph tinh (chu kim cuong khong nhay -> bao loi/inactive ro hon).
  const [pulse, setPulse] = createSignal(0);
  let timer: ReturnType<typeof setInterval> | null = null;
  const isOnline = () => {
    const s = props.status();
    return s === "starting" || s === "ready";
  };
  createEffect(() => {
    if (timer) {
      clearInterval(timer);
      timer = null;
    }
    if (isOnline()) {
      timer = setInterval(() => {
        setPulse((performance.now() / 700) % (Math.PI * 2));
      }, 80);
    } else {
      setPulse(0);
    }
  });
  onCleanup(() => {
    if (timer) clearInterval(timer);
  });
  const glyph = () => {
    const s = props.status();
    if (s === "starting" || s === "ready") {
      return Math.sin(pulse()) > 0 ? "●" : "◌";
    }
    return STATUS_GLYPH[s];
  };
  return (
    <text fg={STATUS_FG[props.status()]} selectable={false}>
      {glyph()}
    </text>
  );
}
const STATUS_LABEL: Record<Status, string> = {
  stopped: "STOPPED",
  starting: "STARTING",
  ready: "RUNNING",
  error: "ERROR",
};

const MAX_LOG_LINES = 500;

// Mau cho tung level: badge bg + label fg trang.
const LEVEL_BG: Record<LogLevel, typeof theme.ok> = {
  info: theme.primary,
  ok: theme.ok,
  warn: theme.warn,
  error: theme.err,
  debug: theme.off,
};
const LEVEL_LABEL: Record<LogLevel, string> = {
  info: "INFO",
  ok: " OK ",
  warn: "WARN",
  error: " ERR",
  debug: "DBG ",
};

function fmtClock(ms: number): string {
  const d = new Date(ms);
  return [d.getHours(), d.getMinutes(), d.getSeconds()]
    .map((n) => String(n).padStart(2, "0"))
    .join(":");
}

const FE_URL = "http://localhost:4321";
const BE_URL = "http://localhost:3000";
const ADMIN_URL = "http://localhost:4321/admin";

function clock() {
  const d = new Date();
  return [d.getHours(), d.getMinutes(), d.getSeconds()]
    .map((n) => String(n).padStart(2, "0"))
    .join(":");
}

function openUrl(url: string): boolean {
  const cmd = process.platform === "win32" ? "cmd" : process.platform === "darwin" ? "open" : "xdg-open";
  const args = process.platform === "win32" ? ["/c", "start", "", url] : [url];
  try {
    Bun.spawn([cmd, ...args], { stdout: "ignore", stderr: "ignore", stdin: "ignore" });
    return true;
  } catch {
    return false;
  }
}

// Cross-platform clipboard. Win: clip.exe stdin UTF-8. macOS: pbcopy. Linux:
// xclip -> fallback wl-copy. Bun spawn detached; await exit code.
async function copyToClipboard(text: string): Promise<boolean> {
  const cmds: string[][] =
    process.platform === "win32"
      ? [["clip"]]
      : process.platform === "darwin"
      ? [["pbcopy"]]
      : [["xclip", "-selection", "clipboard"], ["wl-copy"]];
  for (const cmd of cmds) {
    try {
      const proc = Bun.spawn(cmd, { stdin: "pipe", stdout: "ignore", stderr: "ignore" });
      proc.stdin.write(text);
      await proc.stdin.end();
      const code = await proc.exited;
      if (code === 0) return true;
    } catch {}
  }
  return false;
}

type ButtonProps = {
  label: string;
  hotkey: string;
  accent?: typeof theme.primary;
  onActivate: () => void;
};

function NavButton(props: ButtonProps) {
  const [hover, setHover] = createSignal(false);
  const accent = () => props.accent ?? theme.primary;
  return (
    <box
      flexDirection="row"
      paddingLeft={2}
      paddingRight={2}
      paddingTop={0}
      paddingBottom={0}
      border
      borderColor={hover() ? accent() : theme.border}
      backgroundColor={hover() ? theme.panel : undefined}
      onMouseDown={() => props.onActivate()}
      onMouseOver={() => setHover(true)}
      onMouseOut={() => setHover(false)}
    >
      <text fg={accent()} attributes={TextAttributes.BOLD} selectable={false}>
        {props.hotkey}
      </text>
      <text fg={theme.textMuted} selectable={false}>
        {" "}
      </text>
      <text fg={hover() ? theme.text : theme.textDim} selectable={false}>
        {props.label}
      </text>
    </box>
  );
}

function StatusPill(props: {
  label: string;
  host: string;
  status: () => Status;
  onActivate: () => void;
  accent: typeof theme.primary;
}) {
  const [hover, setHover] = createSignal(false);
  return (
    <box
      flexDirection="row"
      paddingLeft={2}
      paddingRight={2}
      paddingTop={0}
      paddingBottom={0}
      gap={1}
      border
      borderColor={hover() ? props.accent : theme.border}
      backgroundColor={hover() ? theme.panel : undefined}
      onMouseDown={() => props.onActivate()}
      onMouseOver={() => setHover(true)}
      onMouseOut={() => setHover(false)}
    >
      <StatusDot status={props.status} />
      <text fg={props.accent} attributes={TextAttributes.BOLD} selectable={false}>{props.label}</text>
      <text fg={theme.textMuted} selectable={false}>{STATUS_LABEL[props.status()]}</text>
      <text fg={theme.textDim} selectable={false}>· {props.host}</text>
    </box>
  );
}

type Health = { ok: boolean; latency: number; code: number; err?: string; checkedAt: number };

function HealthChip(props: {
  beStatus: () => Status;
  feStatus: () => Status;
  beHealth: () => Health | null;
  feHealth: () => Health | null;
  onActivate: () => void;
}) {
  const [hover, setHover] = createSignal(false);
  const overall = () => {
    const beUp = props.beStatus() === "ready" && (props.beHealth()?.ok ?? true);
    const feUp = props.feStatus() === "ready" && (props.feHealth()?.ok ?? true);
    if (beUp && feUp) return { color: theme.ok, label: "ALL HEALTHY" };
    if (!beUp && !feUp) return { color: theme.err, label: "BOTH DOWN" };
    return { color: theme.warn, label: "PARTIAL" };
  };
  const beLat = () => props.beHealth()?.latency ?? null;
  const feLat = () => props.feHealth()?.latency ?? null;
  return (
    <box
      flexDirection="row"
      paddingLeft={2}
      paddingRight={2}
      gap={2}
      border
      borderColor={hover() ? overall().color : theme.border}
      backgroundColor={hover() ? theme.panel : undefined}
      onMouseDown={() => props.onActivate()}
      onMouseOver={() => setHover(true)}
      onMouseOut={() => setHover(false)}
    >
      <StatusDot status={props.beStatus} />
      <text fg={theme.primary} attributes={TextAttributes.BOLD} selectable={false}>BE</text>
      <text fg={theme.textDim} selectable={false}>
        {beLat() === null ? "—" : `${beLat()}ms`}
      </text>
      <text fg={theme.textMuted} selectable={false}>│</text>
      <StatusDot status={props.feStatus} />
      <text fg={theme.accent} attributes={TextAttributes.BOLD} selectable={false}>FE</text>
      <text fg={theme.textDim} selectable={false}>
        {feLat() === null ? "—" : `${feLat()}ms`}
      </text>
      <text fg={theme.textMuted} selectable={false}>│</text>
      <text fg={overall().color} attributes={TextAttributes.BOLD} selectable={false}>
        {overall().label}
      </text>
    </box>
  );
}

function App() {
  const renderer = useRenderer();
  const [beStatus, setBeStatus] = createSignal<Status>("starting");
  const [feStatus, setFeStatus] = createSignal<Status>("starting");
  const [beLogs, setBeLogs] = createSignal<LogLine[]>([]);
  const [feLogs, setFeLogs] = createSignal<LogLine[]>([]);
  const [now, setNow] = createSignal(clock());
  const [startedAt] = createSignal(Date.now());
  const [uptime, setUptime] = createSignal("0s");
  const [showHelp, setShowHelp] = createSignal(false);
  const [logsOpen, setLogsOpenRaw] = createSignal<"none" | "be" | "fe">("none");
  const [dbOpen, setDbOpenRaw] = createSignal(false);
  const setDbOpen = (v: boolean) => setTimeout(() => setDbOpenRaw(v), 0);
  const [healthOpen, setHealthOpenRaw] = createSignal(false);
  const setHealthOpen = (v: boolean) => setTimeout(() => setHealthOpenRaw(v), 0);
  type Health = { ok: boolean; latency: number; code: number; err?: string; checkedAt: number };
  const [beHealth, setBeHealth] = createSignal<Health | null>(null);
  const [feHealth, setFeHealth] = createSignal<Health | null>(null);
  // FIX segfault: defer setLogsOpen ra khoi current event tick. Click Close
  // button trong overlay -> opentui dispatch mouse event -> callback set state
  // dong bo -> solid unmount overlay NGAY trong khi opentui van o trong mouse
  // handler cua Close button -> use-after-free trong opentui native dll ->
  // segfault. Defer bang setTimeout(0) cho mouse handler return cleanly truoc.
  const setLogsOpen: typeof setLogsOpenRaw = ((v: any) => {
    setTimeout(() => setLogsOpenRaw(v), 0);
  }) as any;
  const [toast, setToast] = createSignal<string | null>(null);
  let toastTimer: ReturnType<typeof setTimeout> | null = null;

  const flash = (msg: string) => {
    setToast(msg);
    if (toastTimer) clearTimeout(toastTimer);
    toastTimer = setTimeout(() => setToast(null), 1800);
  };

  // One-click "share with maintainer" bundle. Writes a single text file at
  // cwd containing system info + license payload (if a `nexora.license`
  // file is sitting next to the install) + every backend/frontend log line
  // currently held in the ring buffers. Customer drops the file into a
  // chat with support — saves the "how do I copy from a TUI?" round-trip.
  const saveBundle = () => {
    try {
      const ts = new Date();
      const stamp = ts
        .toISOString()
        .replace(/[:.]/g, "-")
        .replace(/Z$/, "");
      const fname = `nexora-support-${stamp}.txt`;
      const path = resolve(process.cwd(), fname);
      const fmtLine = (l: LogLine) =>
        `${new Date(l.ts).toISOString()} [${l.level.toUpperCase()}] ${l.text}`;
      const licPath = resolve(process.cwd(), "nexora.license");
      let license = "(no nexora.license file found at cwd)";
      if (existsSync(licPath)) {
        try {
          license = readFileSync(licPath, "utf-8");
        } catch (e) {
          license = `(read failed: ${e instanceof Error ? e.message : String(e)})`;
        }
      }
      const body = [
        "=== NEXORA SUPPORT BUNDLE ===",
        `generated: ${ts.toISOString()}`,
        `os:        ${process.platform} ${process.arch}`,
        `bun:       ${process.versions.bun ?? "?"}`,
        `cwd:       ${process.cwd()}`,
        `uptime:    ${uptime()}`,
        `be:        ${beStatus()} · health=${JSON.stringify(beHealth())}`,
        `fe:        ${feStatus()} · health=${JSON.stringify(feHealth())}`,
        "",
        "--- license (nexora.license) ---",
        license.trim(),
        "",
        `--- backend logs (${beLogs().length} lines) ---`,
        beLogs().map(fmtLine).join(String.fromCharCode(10)) || "(no output yet)",
        "",
        `--- frontend logs (${feLogs().length} lines) ---`,
        feLogs().map(fmtLine).join(String.fromCharCode(10)) || "(no output yet)",
        "",
        "=== END ===",
      ].join(String.fromCharCode(10));
      writeFileSync(path, body);
      flash(`saved → ${fname}`);
    } catch (e) {
      flash(`save failed: ${e instanceof Error ? e.message : String(e)}`);
    }
  };

  let beHandle: ProcHandle | null = null;
  let feHandle: ProcHandle | null = null;

  const pushLog = (setter: (fn: (prev: LogLine[]) => LogLine[]) => void) => (line: LogLine) => {
    setter((prev) => {
      const next = [...prev, line];
      if (next.length > MAX_LOG_LINES) next.splice(0, next.length - MAX_LOG_LINES);
      return next;
    });
  };

  const spawnBackend = () => {
    beHandle = startProcess({
      cmd: ["bun", "--cwd", "backend", "dev"],
      readyPattern: /listening on|ready on|localhost:3000/i,
      onStatus: setBeStatus,
      onLog: pushLog(setBeLogs),
    });
  };
  const spawnFrontend = () => {
    feHandle = startProcess({
      cmd: ["bun", "--cwd", "frontend", "dev"],
      readyPattern: /astro|localhost:4321|ready in/i,
      onStatus: setFeStatus,
      onLog: pushLog(setFeLogs),
    });
  };

  const ping = async (url: string, signal: AbortSignal): Promise<Health> => {
    const t0 = performance.now();
    try {
      const res = await fetch(url, { signal, redirect: "manual" });
      const latency = Math.round(performance.now() - t0);
      // 3xx tu Astro dev = ok (dev server). 2xx = ok. 5xx = down.
      const ok = res.status < 500;
      return { ok, latency, code: res.status, checkedAt: Date.now() };
    } catch (e: any) {
      return {
        ok: false,
        latency: Math.round(performance.now() - t0),
        code: 0,
        err: e?.message ?? String(e),
        checkedAt: Date.now(),
      };
    }
  };

  onMount(() => {
    spawnBackend();
    spawnFrontend();

    const t = setInterval(() => {
      setNow(clock());
      const sec = Math.floor((Date.now() - startedAt()) / 1000);
      const m = Math.floor(sec / 60);
      const s = sec % 60;
      setUptime(m > 0 ? `${m}m ${s}s` : `${s}s`);
    }, 1000);

    // Health probe: ping moi 5s. AbortController moi probe de tranh leak khi
    // server bi treo va ko reply.
    let beAbort: AbortController | null = null;
    let feAbort: AbortController | null = null;
    const probe = async () => {
      beAbort?.abort();
      feAbort?.abort();
      beAbort = new AbortController();
      feAbort = new AbortController();
      const beTimeout = setTimeout(() => beAbort?.abort(), 3000);
      const feTimeout = setTimeout(() => feAbort?.abort(), 3000);
      const [be, fe] = await Promise.all([
        ping(`${BE_URL}/api/health`, beAbort.signal),
        ping(FE_URL, feAbort.signal),
      ]);
      clearTimeout(beTimeout);
      clearTimeout(feTimeout);
      setBeHealth(be);
      setFeHealth(fe);
    };
    // Probe lan dau sau khi BE/FE co thoi gian boot.
    const firstProbe = setTimeout(probe, 3000);
    const probeTimer = setInterval(probe, 5000);

    onCleanup(() => {
      clearInterval(t);
      clearTimeout(firstProbe);
      clearInterval(probeTimer);
      beAbort?.abort();
      feAbort?.abort();
      beHandle?.kill();
      feHandle?.kill();
      if (toastTimer) clearTimeout(toastTimer);
    });
  });

  const exitClean = () => {
    beHandle?.kill();
    feHandle?.kill();
    if (toastTimer) clearTimeout(toastTimer);
    try { renderer.destroy?.(); } catch {}
    process.stdout.write("\x1b[0m\x1b[?25h\x1b[?1049l\x1b]110\x07\x1b]111\x07\x1b]112\x07");
    process.exit(0);
  };

  const restartBackend = () => {
    beHandle?.kill();
    setBeLogs([]);
    spawnBackend();
    flash("backend restarted");
  };
  const restartFrontend = () => {
    feHandle?.kill();
    setFeLogs([]);
    spawnFrontend();
    flash("frontend restarted");
  };
  const restartAll = () => {
    restartBackend();
    restartFrontend();
    flash("all services restarted");
  };

  const open = (url: string, label: string) => {
    if (openUrl(url)) flash(`opening ${label}`);
    else flash(`failed to open ${label}`);
  };

  useKeyboard((key: any) => {
    if (key.name === "q" || (key.name === "c" && key.ctrl) || (key.ctrl && key.sequence === "\x03")) {
      exitClean();
      return;
    }
    if (key.name === "escape") {
      if (showHelp()) setShowHelp(false);
      else if (dbOpen()) setDbOpen(false);
      else if (healthOpen()) setHealthOpen(false);
      else if (logsOpen() !== "none") setLogsOpen("none");
      return;
    }
    if (key.name === "?" || key.sequence === "?") setShowHelp((v) => !v);
    if (key.name === "h") setShowHelp((v) => !v);
    if (key.sequence === "H") setHealthOpen(!healthOpen());
    if (key.name === "d") setDbOpen(!dbOpen());
    if (key.name === "o") open(FE_URL, "frontend");
    if (key.name === "a") open(ADMIN_URL, "admin");
    if (key.name === "r") restartAll();
    if (key.name === "l") {
      setLogsOpen((v) => (v === "none" ? "be" : v === "be" ? "fe" : "none"));
    }
    if (key.name === "k") {
      const view = logsOpen();
      if (view === "be") { setBeLogs([]); flash("backend logs cleared"); }
      else if (view === "fe") { setFeLogs([]); flash("frontend logs cleared"); }
      else { setBeLogs([]); setFeLogs([]); flash("all logs cleared"); }
    }
    if (key.name === "tab" && logsOpen() !== "none") {
      setLogsOpen((v) => (v === "be" ? "fe" : "be"));
    }
  });

  process.on("SIGINT", exitClean);
  process.on("SIGTERM", exitClean);

  return (
    <box width="100%" height="100%" flexDirection="column">
      {/* Full-screen starry background. Exclude center stack (logo + pills +
          buttons) khoi vung sinh sao va meteor -> text luon ro rang, khong bi
          de bi sao hay sao bang bay qua. */}
      {/* Bo rectangular exclusion: meteor bay tu do khap noi. Tung "card" UI
          o duoi (pill, button, logo) co backgroundColor opaque -> chi che cell
          chua text + 1 cell padding (qua paddingLR/borders), meteor xuyen qua
          khe ho giua cac card binh thuong. */}
      <StarryBackground />

      {/* Top bar — branding + clock + uptime. zIndex>background. */}
      <box
        width="100%"
        height={1}
        flexShrink={0}
        flexDirection="row"
        paddingLeft={2}
        paddingRight={2}
        justifyContent="space-between"
        zIndex={10}
      >
        <text fg={theme.primary} attributes={TextAttributes.BOLD} selectable={false}>
          NEXORA · dev dashboard
        </text>
        <text fg={theme.textDim} selectable={false}>
          {now()} · up {uptime()}
        </text>
      </box>

      {/* Center stack: logo + status pills + button bar. zIndex>background. */}
      <box
        width="100%"
        flexGrow={1}
        flexDirection="column"
        alignItems="center"
        justifyContent="center"
        gap={1}
        zIndex={10}
      >
        <Logo />
        <box height={1} />
        {/* Health summary chip - thay 2 status pill cu, click mo HealthOverlay. */}
        <HealthChip
          beStatus={beStatus}
          feStatus={feStatus}
          beHealth={beHealth}
          feHealth={feHealth}
          onActivate={() => setHealthOpen(true)}
        />
        <box height={1} />
        <box flexDirection="row" gap={2}>
          <NavButton label="Frontend" hotkey="o" onActivate={() => open(FE_URL, "frontend")} />
          <NavButton label="Admin" hotkey="a" onActivate={() => open(ADMIN_URL, "admin")} />
          <NavButton label="Health" hotkey="H" accent={theme.ok} onActivate={() => setHealthOpen(true)} />
          <NavButton label="Database" hotkey="d" accent={theme.accent} onActivate={() => setDbOpen(true)} />
          <NavButton label="Restart" hotkey="r" accent={theme.warn} onActivate={restartAll} />
          <NavButton label="Logs" hotkey="l" onActivate={() => setLogsOpen((v) => (v === "none" ? "be" : "none"))} />
          <NavButton label="Help" hotkey="?" onActivate={() => setShowHelp((v) => !v)} />
          <NavButton label="Quit" hotkey="q" accent={theme.err} onActivate={exitClean} />
        </box>
      </box>

      {/* Bottom hint */}
      <box
        width="100%"
        height={1}
        flexShrink={0}
        flexDirection="row"
        paddingLeft={2}
        paddingRight={2}
        justifyContent="space-between"
      >
        <text fg={theme.textMuted} selectable={false}>
          click anywhere · or press hotkeys above
        </text>
        <text fg={theme.textMuted} selectable={false}>
          0.3.0
        </text>
      </box>

      {/* Toast */}
      <Show when={toast() !== null}>
        <box
          position="absolute"
          top={2}
          left="38%"
          width="24%"
          paddingLeft={2}
          paddingRight={2}
          backgroundColor={theme.panel}
          border
          borderColor={theme.primary}
          alignItems="center"
          justifyContent="center"
          zIndex={50}
        >
          <text fg={theme.primary} attributes={TextAttributes.BOLD} selectable={false}>
            {toast() ?? ""}
          </text>
        </box>
      </Show>

      {/* Logs overlay */}
      <Show when={logsOpen() !== "none"}>
        <LogsOverlay
          which={logsOpen as () => "be" | "fe"}
          beLogs={beLogs}
          feLogs={feLogs}
          beStatus={beStatus}
          feStatus={feStatus}
          onSwitch={(w) => setLogsOpen(w)}
          onClose={() => setLogsOpen("none")}
          onRestart={() => (logsOpen() === "be" ? restartBackend() : restartFrontend())}
          onClear={() => {
            const w = logsOpen();
            if (w === "be") { setBeLogs([]); flash("backend logs cleared"); }
            else if (w === "fe") { setFeLogs([]); flash("frontend logs cleared"); }
          }}
          onSave={saveBundle}
          onCopy={async () => {
            const w = logsOpen();
            const arr = w === "be" ? beLogs() : feLogs();
            if (arr.length === 0) {
              flash("no logs to copy");
              return;
            }
            const text = arr
              .map((l) => `${new Date(l.ts).toISOString()} [${l.level.toUpperCase()}] ${l.text}`)
              .join(String.fromCharCode(10));
            if (await copyToClipboard(text)) flash(`${arr.length} log lines copied`);
            else flash("clipboard copy failed");
          }}
        />
      </Show>

      {/* Health overlay */}
      <Show when={healthOpen()}>
        <HealthOverlay
          beStatus={beStatus}
          feStatus={feStatus}
          beHealth={beHealth}
          feHealth={feHealth}
          onClose={() => setHealthOpen(false)}
        />
      </Show>

      {/* Database editor overlay */}
      <Show when={dbOpen()}>
        <DbOverlay onClose={() => setDbOpen(false)} flash={flash} />
      </Show>

      {/* Help overlay */}
      <Show when={showHelp()}>
        <box
          position="absolute"
          top="20%"
          left="28%"
          width="44%"
          flexDirection="column"
          paddingLeft={2}
          paddingRight={2}
          paddingTop={1}
          paddingBottom={1}
          backgroundColor={theme.panel}
          border
          borderColor={theme.primary}
          zIndex={100}
        >
          <text fg={theme.primary} attributes={TextAttributes.BOLD} selectable={false}>
            NEXORA DEV DASHBOARD — HELP
          </text>
          <text fg={theme.textMuted} selectable={false}>
            ───────────────────────────────────
          </text>
          <text fg={theme.text} selectable={false}>click any button — or use the hotkey shown</text>
          <box height={1} />
          <text fg={theme.text} selectable={false}>o            open frontend (localhost:4321)</text>
          <text fg={theme.text} selectable={false}>a            open admin panel</text>
          <text fg={theme.text} selectable={false}>H            toggle health overlay (live ping)</text>
          <text fg={theme.text} selectable={false}>d            toggle database editor overlay</text>
          <text fg={theme.text} selectable={false}>r            restart both services</text>
          <text fg={theme.text} selectable={false}>l            cycle logs overlay (BE → FE → off)</text>
          <text fg={theme.text} selectable={false}>k            clear focused logs</text>
          <text fg={theme.text} selectable={false}>s            save support bundle (in logs view)</text>
          <text fg={theme.text} selectable={false}>tab          switch BE/FE in logs overlay</text>
          <text fg={theme.text} selectable={false}>? / h        toggle this help</text>
          <text fg={theme.text} selectable={false}>esc          close any overlay</text>
          <text fg={theme.text} selectable={false}>q / ctrl-c   quit</text>
          <text fg={theme.textMuted} selectable={false}>
            ───────────────────────────────────
          </text>
          <text fg={theme.textDim} selectable={false}>
            press esc or ? to dismiss
          </text>
        </box>
      </Show>
    </box>
  );
}

function HealthOverlay(props: {
  beStatus: () => Status;
  feStatus: () => Status;
  beHealth: () => Health | null;
  feHealth: () => Health | null;
  onClose: () => void;
}) {
  const fmtAge = (ts: number) => {
    const sec = Math.max(0, Math.round((Date.now() - ts) / 1000));
    return `${sec}s ago`;
  };
  const Row = (p: {
    label: string;
    accent: typeof theme.primary;
    status: () => Status;
    health: () => Health | null;
    url: string;
  }) => (
    <box flexDirection="column" gap={0} paddingTop={1}>
      <box flexDirection="row" gap={2}>
        <StatusDot status={p.status} />
        <text fg={p.accent} attributes={TextAttributes.BOLD} selectable={false}>{p.label}</text>
        <text fg={theme.textDim} selectable={false}>{p.url}</text>
      </box>
      <Show
        when={p.health() !== null}
        fallback={<text fg={theme.textMuted} selectable={false}>  no probe yet — first ping after 3s</text>}
      >
        <box flexDirection="row" gap={2}>
          <text fg={theme.textMuted} selectable={false}>  proc:</text>
          <text fg={STATUS_FG[p.status()]} selectable={false}>{STATUS_LABEL[p.status()]}</text>
          <text fg={theme.textMuted} selectable={false}>· http:</text>
          <text
            fg={p.health()!.ok ? theme.ok : theme.err}
            attributes={TextAttributes.BOLD}
            selectable={false}
          >
            {p.health()!.code === 0 ? "NO RESPONSE" : `${p.health()!.code} ${p.health()!.ok ? "OK" : "DOWN"}`}
          </text>
          <text fg={theme.textMuted} selectable={false}>· latency:</text>
          <text
            fg={p.health()!.latency < 100 ? theme.ok : p.health()!.latency < 500 ? theme.warn : theme.err}
            attributes={TextAttributes.BOLD}
            selectable={false}
          >
            {p.health()!.latency}ms
          </text>
          <text fg={theme.textMuted} selectable={false}>· checked:</text>
          <text fg={theme.textDim} selectable={false}>{fmtAge(p.health()!.checkedAt)}</text>
        </box>
        <Show when={p.health()!.err !== undefined}>
          <text fg={theme.err} selectable={false}>  error: {p.health()!.err}</text>
        </Show>
      </Show>
    </box>
  );

  return (
    <box
      position="absolute"
      top="18%"
      left="20%"
      width="60%"
      flexDirection="column"
      paddingLeft={2}
      paddingRight={2}
      paddingTop={1}
      paddingBottom={1}
      backgroundColor={theme.background}
      border
      borderColor={theme.ok}
      zIndex={90}
    >
      <box flexDirection="row" gap={2}>
        <text fg={theme.ok} attributes={TextAttributes.BOLD} selectable={false}>HEALTH MONITOR</text>
        <box flexGrow={1} />
        <text fg={theme.textMuted} selectable={false}>auto-refresh every 5s</text>
        <box width={1} />
        <NavButton label="Close (esc)" hotkey="" accent={theme.err} onActivate={props.onClose} />
      </box>
      <text fg={theme.border} selectable={false}>────────────────────────────────────</text>
      <Row label="BACKEND" accent={theme.primary} status={props.beStatus} health={props.beHealth} url={`${BE_URL}/api/health`} />
      <Row label="FRONTEND" accent={theme.accent} status={props.feStatus} health={props.feHealth} url={FE_URL} />
      <box height={1} />
      <text fg={theme.textDim} selectable={false}>
        {"latency tier: <100ms ok · <500ms warn · ≥500ms slow"}
      </text>
    </box>
  );
}

function DbOverlay(props: { onClose: () => void; flash: (msg: string) => void }) {
  // SQL editor da bo: opentui <input> widget + nested Show fallback gay segfault
  // tren Windows (use-after-free trong Yoga layout). Giu read-only browser
  // - on dinh, du de inspect data va export.
  const [tables, setTables] = createSignal<{ name: string; rowCount: number }[]>([]);
  const [error, setError] = createSignal<string | null>(null);
  const [active, setActive] = createSignal<string | null>(null);
  const [columns, setColumns] = createSignal<string[]>([]);
  const [rows, setRows] = createSignal<Record<string, unknown>[]>([]);
  const [page, setPage] = createSignal(0);
  const [total, setTotal] = createSignal(0);
  const PAGE_SIZE = 20;

  const refresh = async () => {
    try {
      const mod = await import("./db");
      setTables(mod.listTables());
      setError(null);
    } catch (e: any) {
      setError(e?.message ?? String(e));
    }
  };

  const loadTable = async (name: string, p: number) => {
    try {
      const mod = await import("./db");
      const cols = mod.describeTable(name).map((c) => c.name);
      const found = tables().find((t) => t.name === name);
      const t = found ? found.rowCount : 0;
      const r = mod.fetchRows(name, PAGE_SIZE, p * PAGE_SIZE);
      setActive(name);
      setColumns(cols);
      setRows(r);
      setPage(p);
      setTotal(t);
    } catch (e: any) {
      setError(e?.message ?? String(e));
    }
  };

  const exportJson = async () => {
    if (!active()) {
      props.flash("select a table first");
      return;
    }
    const json = JSON.stringify(rows(), null, 2);
    if (await copyToClipboard(json)) props.flash(`${rows().length} rows copied as JSON`);
    else props.flash("clipboard copy failed");
  };

  onMount(() => {
    refresh();
  });

  const totalPages = () => Math.max(1, Math.ceil(total() / PAGE_SIZE));

  return (
    <box
      position="absolute"
      top="4%"
      left="4%"
      width="92%"
      height="92%"
      flexDirection="column"
      paddingLeft={1}
      paddingRight={1}
      paddingTop={1}
      paddingBottom={1}
      backgroundColor={theme.background}
      border
      borderColor={theme.accent}
      zIndex={90}
    >
      <box flexDirection="row" gap={2} flexShrink={0} paddingLeft={1} paddingRight={1}>
        <text fg={theme.accent} attributes={TextAttributes.BOLD} selectable={false}>
          DATABASE BROWSER
        </text>
        <text fg={theme.textMuted} selectable={false}>
          {tables().length} tables
        </text>
        <box flexGrow={1} />
        <NavButton label="Copy JSON" hotkey="" accent={theme.ok} onActivate={exportJson} />
        <NavButton label="Refresh" hotkey="" onActivate={refresh} />
        <NavButton label="Close (esc)" hotkey="" accent={theme.err} onActivate={props.onClose} />
      </box>
      <text fg={theme.border} selectable={false}>────────────────────────────────────</text>

      <Show when={error() !== null}>
        <text fg={theme.err} selectable={false}>error: {error()}</text>
      </Show>

      <box flexDirection="row" flexGrow={1} gap={1}>
        <box flexDirection="column" width="22%" flexShrink={0}>
          <text fg={theme.textMuted} selectable={false}>TABLES</text>
          <text fg={theme.border} selectable={false}>──────────────</text>
          <scrollbox flexGrow={1} viewportOptions={{ paddingRight: 0 }}>
            <For each={tables()}>
              {(t) => (
                <TableListItem
                  name={t.name}
                  count={t.rowCount}
                  active={() => active() === t.name}
                  onActivate={() => loadTable(t.name, 0)}
                />
              )}
            </For>
          </scrollbox>
        </box>

        <box flexDirection="column" flexGrow={1}>
          <Show
            when={active() !== null}
            fallback={
              <text fg={theme.textMuted} selectable={false}>
                ← select a table on the left to browse rows
              </text>
            }
          >
            <box flexDirection="row" gap={2} flexShrink={0}>
              <text fg={theme.accent} attributes={TextAttributes.BOLD} selectable={false}>
                {active()}
              </text>
              <text fg={theme.textDim} selectable={false}>
                page {page() + 1}/{totalPages()} · {total()} rows total
              </text>
              <box flexGrow={1} />
              <NavButton label="← prev" hotkey="" onActivate={() => loadTable(active()!, Math.max(0, page() - 1))} />
              <NavButton label="next →" hotkey="" onActivate={() => loadTable(active()!, Math.min(totalPages() - 1, page() + 1))} />
            </box>
            <text fg={theme.border} selectable={false}>────────────────────────</text>
            <DataTable columns={columns()} rows={rows()} />
          </Show>
        </box>
      </box>
    </box>
  );
}function TableListItem(props: {
  name: string;
  count: number;
  active: () => boolean;
  onActivate: () => void;
}) {
  const [hover, setHover] = createSignal(false);
  return (
    <box
      flexDirection="row"
      paddingLeft={1}
      paddingRight={1}
      gap={1}
      backgroundColor={props.active() ? theme.accent : hover() ? theme.panel : undefined}
      onMouseDown={() => props.onActivate()}
      onMouseOver={() => setHover(true)}
      onMouseOut={() => setHover(false)}
    >
      <text
        fg={props.active() ? theme.background : theme.text}
        attributes={props.active() ? TextAttributes.BOLD : 0}
        selectable={false}
      >
        {props.name}
      </text>
      <box flexGrow={1} />
      <text
        fg={props.active() ? theme.background : theme.textMuted}
        selectable={false}
      >
        {props.count}
      </text>
    </box>
  );
}

function DataTable(props: { columns: string[]; rows: Record<string, unknown>[] }) {
  // Render bang dang scrollable. Moi col fixed width 18 chars de don gian.
  const COL_W = 18;
  const fmtCellLocal = (v: unknown): string => {
    if (v === null || v === undefined) return "NULL";
    if (typeof v === "string") return v.length > COL_W - 1 ? v.slice(0, COL_W - 4) + "..." : v;
    if (typeof v === "object") {
      if (v instanceof Uint8Array) return `<blob ${v.length}b>`;
      const s = JSON.stringify(v);
      return s.length > COL_W - 1 ? s.slice(0, COL_W - 4) + "..." : s;
    }
    const s = String(v);
    return s.length > COL_W - 1 ? s.slice(0, COL_W - 4) + "..." : s;
  };
  const padRight = (s: string, w: number) => (s.length >= w ? s : s + " ".repeat(w - s.length));

  return (
    <box flexDirection="column" flexGrow={1}>
      {/* Column header */}
      <box flexDirection="row" flexShrink={0}>
        <For each={props.columns}>
          {(c) => (
            <text
              fg={theme.accent}
              attributes={TextAttributes.BOLD}
              selectable={false}
            >
              {padRight(c.length > COL_W - 1 ? c.slice(0, COL_W - 1) : c, COL_W)}
            </text>
          )}
        </For>
      </box>
      <text fg={theme.border} selectable={false}>
        {"─".repeat(Math.min(props.columns.length * COL_W, 200))}
      </text>
      <scrollbox flexGrow={1} viewportOptions={{ paddingRight: 0 }} scrollbarOptions={{ visible: true, showArrows: false }}>
        <For each={props.rows}>
          {(row) => (
            <box flexDirection="row" flexShrink={0}>
              <For each={props.columns}>
                {(c) => {
                  const v = row[c];
                  const isNull = v === null || v === undefined;
                  return (
                    <text fg={isNull ? theme.textMuted : theme.text} selectable={true}>
                      {padRight(fmtCellLocal(v), COL_W)}
                </text>
                  );
                }}
              </For>
            </box>
          )}
        </For>
        <Show when={props.rows.length === 0}>
          <text fg={theme.textMuted} selectable={false}>(no rows)</text>
        </Show>
      </scrollbox>
    </box>
  );
}

function FilterChip(props: {
  label: string;
  count: number;
  active: () => boolean;
  accent: typeof theme.primary;
  onActivate: () => void;
}) {
  const [hover, setHover] = createSignal(false);
  return (
    <box
      paddingLeft={1}
      paddingRight={1}
      flexDirection="row"
      gap={1}
      backgroundColor={props.active() ? props.accent : hover() ? theme.panel : undefined}
      onMouseDown={() => props.onActivate()}
      onMouseOver={() => setHover(true)}
      onMouseOut={() => setHover(false)}
    >
      <text
        fg={props.active() ? theme.background : props.accent}
        attributes={TextAttributes.BOLD}
        selectable={false}
      >
        {props.label}
      </text>
      <text fg={props.active() ? theme.background : theme.textMuted} selectable={false}>
        {String(props.count)}
      </text>
    </box>
  );
}

function LogRow(props: { line: LogLine }) {
  return (
    <box flexDirection="row" gap={1} flexShrink={0}>
      <text fg={theme.textMuted} selectable={false}>
        {fmtClock(props.line.ts)}
      </text>
      <text
        fg={theme.background}
        bg={LEVEL_BG[props.line.level]}
        attributes={TextAttributes.BOLD}
        selectable={false}
      >
        {" "}
        {LEVEL_LABEL[props.line.level]}
        {" "}
      </text>
      <text fg={theme.text} wrapMode="word">
        {props.line.text}
      </text>
    </box>
  );
}

function LogsOverlay(props: {
  which: () => "be" | "fe";
  beLogs: () => LogLine[];
  feLogs: () => LogLine[];
  beStatus: () => Status;
  feStatus: () => Status;
  onSwitch: (w: "be" | "fe") => void;
  onClose: () => void;
  onRestart: () => void;
  onClear: () => void;
  onSave: () => void;
  onCopy: () => void;
}) {
  const [filter, setFilter] = createSignal<LogLevel | "all">("all");
  const lines = () => (props.which() === "be" ? props.beLogs() : props.feLogs());
  const filtered = () => {
    const f = filter();
    return f === "all" ? lines() : lines().filter((l) => l.level === f);
  };
  const visible = () => {
    const arr = filtered();
    return arr.length > 200 ? arr.slice(-200) : arr;
  };
  const counts = () => {
    const c: Record<LogLevel, number> = { info: 0, ok: 0, warn: 0, error: 0, debug: 0 };
    for (const l of lines()) c[l.level]++;
    return c;
  };
  const status = () => (props.which() === "be" ? props.beStatus() : props.feStatus());
  const title = () => (props.which() === "be" ? "BACKEND LOGS" : "FRONTEND LOGS");
  const accent = () => (props.which() === "be" ? theme.primary : theme.accent);

  return (
    <box
      position="absolute"
      top="6%"
      left="6%"
      width="88%"
      height="88%"
      flexDirection="column"
      paddingLeft={1}
      paddingRight={1}
      paddingTop={1}
      paddingBottom={1}
      backgroundColor={theme.background}
      border
      borderColor={accent()}
      zIndex={80}
    >
      {/* Header — tabs + actions */}
      <box flexDirection="row" gap={1} flexShrink={0} paddingLeft={1} paddingRight={1}>
        <Tab label="BACKEND" active={() => props.which() === "be"} accent={theme.primary} onActivate={() => props.onSwitch("be")} />
        <Tab label="FRONTEND" active={() => props.which() === "fe"} accent={theme.accent} onActivate={() => props.onSwitch("fe")} />
        <box flexGrow={1} />
        <StatusDot status={status} />
        <text fg={theme.textMuted} selectable={false}>{STATUS_LABEL[status()]}</text>
        <text fg={theme.textMuted} selectable={false}>· {lines().length} lines</text>
        <box width={2} />
        <NavButton label="Copy" hotkey="" accent={theme.ok} onActivate={props.onCopy} />
        <NavButton label="Save (s)" hotkey="" accent={theme.ok} onActivate={props.onSave} />
        <NavButton label="Clear (k)" hotkey="" onActivate={props.onClear} />
        <NavButton label="Restart (r)" hotkey="" accent={theme.warn} onActivate={props.onRestart} />
        <NavButton label="Close (esc)" hotkey="" accent={theme.err} onActivate={props.onClose} />
      </box>

      {/* Filter chips row */}
      <box flexDirection="row" gap={1} flexShrink={0} paddingLeft={1} paddingRight={1} paddingTop={1}>
        <text fg={theme.textMuted} selectable={false}>filter:</text>
        <FilterChip label="all" count={lines().length} active={() => filter() === "all"} accent={theme.text} onActivate={() => setFilter("all")} />
        <FilterChip label="ok" count={counts().ok} active={() => filter() === "ok"} accent={theme.ok} onActivate={() => setFilter("ok")} />
        <FilterChip label="info" count={counts().info} active={() => filter() === "info"} accent={theme.primary} onActivate={() => setFilter("info")} />
        <FilterChip label="warn" count={counts().warn} active={() => filter() === "warn"} accent={theme.warn} onActivate={() => setFilter("warn")} />
        <FilterChip label="err" count={counts().error} active={() => filter() === "error"} accent={theme.err} onActivate={() => setFilter("error")} />
        <FilterChip label="dbg" count={counts().debug} active={() => filter() === "debug"} accent={theme.off} onActivate={() => setFilter("debug")} />
      </box>

      <text fg={theme.border} selectable={false}>────────────────────────────────────</text>

      <scrollbox
        flexGrow={1}
        focused
        stickyScroll
        stickyStart="bottom"
        viewportOptions={{ paddingRight: 0 }}
        scrollbarOptions={{ visible: true, showArrows: false }}
      >
        <For each={visible()}>
          {(line) => <LogRow line={line} />}
        </For>
        <Show when={visible().length === 0}>
          <text fg={theme.textMuted} selectable={false}>
            {lines().length === 0 ? "waiting for output..." : `no ${filter()} entries`}
          </text>
        </Show>
      </scrollbox>
    </box>
  );
}

function Tab(props: { label: string; active: () => boolean; accent: typeof theme.primary; onActivate: () => void }) {
  return (
    <box
      paddingLeft={2}
      paddingRight={2}
      border
      borderColor={props.active() ? props.accent : theme.border}
      backgroundColor={props.active() ? theme.panel : undefined}
      onMouseDown={() => props.onActivate()}
    >
      <text
        fg={props.active() ? props.accent : theme.textDim}
        attributes={props.active() ? TextAttributes.BOLD : 0}
        selectable={false}
      >
        {props.label}
      </text>
    </box>
  );
}

render(App, {
  exitOnCtrlC: false,
  targetFps: 60,
  openConsoleOnError: false,
  consoleOptions: { open: false },
  useMouse: true,
});