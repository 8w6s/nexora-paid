import { Box, render, Text, useInput } from "ink";
import type React from "react";
import { useEffect, useRef, useState } from "react";
import { createInterface } from "readline";
import { Readable } from "stream";

// Spawning processes with color output forced
const env = { ...process.env, FORCE_COLOR: "1" };

// biome-ignore lint/suspicious/noExplicitAny: Bun.spawn return type contains any internally
const activeProcesses = {
  backend: null as ReturnType<typeof Bun.spawn> | null,
  frontend: null as ReturnType<typeof Bun.spawn> | null,
};

const cleanup = () => {
  if (activeProcesses.backend) {
    try {
      activeProcesses.backend.kill();
    } catch (e) {}
  }
  if (activeProcesses.frontend) {
    try {
      activeProcesses.frontend.kill();
    } catch (e) {}
  }
  process.exit(0);
};

const fmtTime = (d: Date) =>
  `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}:${String(d.getSeconds()).padStart(2, "0")}`;

const fmtUptime = (sec: number) => {
  if (sec < 60) return `${sec}s`;
  const m = Math.floor(sec / 60);
  const s = sec % 60;
  if (m < 60) return `${m}m ${s}s`;
  const h = Math.floor(m / 60);
  return `${h}h ${m % 60}m`;
};

const stripAnsi = (s: string) => s.replace(/\x1b\[[0-9;]*m/g, "");

const KeyboardListener = ({
  maxLogs,
  backendLogsCount,
  frontendLogsCount,
  setBackendScroll,
  setFrontendScroll,
  focusedBtn,
  setFocusedBtn,
  onRestartAll,
  onClearLogs,
  onStopAll,
}: {
  maxLogs: number;
  backendLogsCount: number;
  frontendLogsCount: number;
  setBackendScroll: React.Dispatch<React.SetStateAction<number>>;
  setFrontendScroll: React.Dispatch<React.SetStateAction<number>>;
  focusedBtn: number;
  setFocusedBtn: React.Dispatch<React.SetStateAction<number>>;
  onRestartAll: () => void;
  onClearLogs: () => void;
  onStopAll: () => void;
}) => {
  const refs = useRef({ maxLogs, backendLogsCount, frontendLogsCount, focusedBtn, onRestartAll, onClearLogs, onStopAll });

  useEffect(() => {
    refs.current = { maxLogs, backendLogsCount, frontendLogsCount, focusedBtn, onRestartAll, onClearLogs, onStopAll };
  }, [maxLogs, backendLogsCount, frontendLogsCount, focusedBtn, onRestartAll, onClearLogs, onStopAll]);

  useInput((input, key) => {
    const { maxLogs: cMax, backendLogsCount: cBE, frontendLogsCount: cFE, focusedBtn: cBtn, onRestartAll: cRestart, onClearLogs: cClear, onStopAll: cStop } = refs.current;

    if (input === "r" || input === "R") { cRestart(); return; }
    if (input === "c" || input === "C") { cClear(); return; }
    if (input === "q" || input === "Q" || key.escape) { cStop(); return; }

    if (key.tab) { setFocusedBtn((prev) => (prev + 1) % 3); return; }

    if (key.return) {
      if (cBtn === 0) cRestart();
      else if (cBtn === 1) cClear();
      else if (cBtn === 2) cStop();
      return;
    }

    if (input === "w" || input === "W") {
      setBackendScroll((prev) => Math.min(cBE - cMax, prev + 1));
    } else if (input === "s" || input === "S") {
      setBackendScroll((prev) => Math.max(0, prev - 1));
    }
    if (key.upArrow) {
      setFrontendScroll((prev) => Math.min(cFE - cMax, prev + 1));
    } else if (key.downArrow) {
      setFrontendScroll((prev) => Math.max(0, prev - 1));
    }
  });

  return null;
};

const StatusDot = ({ ready, running }: { ready: boolean; running: boolean }) => {
  if (!running) return <Text color="gray">○</Text>;
  if (!ready) return <Text color="yellow">●</Text>;
  return <Text color="green">●</Text>;
};

const StatusText = ({ ready, running }: { ready: boolean; running: boolean }) => {
  if (!running) return <Text color="gray">stopped</Text>;
  if (!ready) return <Text color="yellow">starting</Text>;
  return <Text color="green">ready</Text>;
};

const FooterKey = ({
  label,
  hotkey,
  focused,
  accent,
}: {
  label: string;
  hotkey: string;
  focused: boolean;
  accent: "cyan" | "yellow" | "red";
}) => (
  <Box>
    <Text color={focused ? accent : "gray"} bold={focused}>[{hotkey}]</Text>
    <Text color={focused ? accent : "white"} bold={focused}> {label}</Text>
  </Box>
);

const DevRunner = () => {
  const [backendLogs, setBackendLogs] = useState<string[]>([]);
  const [frontendLogs, setFrontendLogs] = useState<string[]>([]);
  const [backendScroll, setBackendScroll] = useState(0);
  const [frontendScroll, setFrontendScroll] = useState(0);
  const [errorsCount, setErrorsCount] = useState({ low: 0, medium: 0, high: 0 });
  const [terminalRows, setTerminalRows] = useState(process.stdout.rows || 24);
  const [terminalCols, setTerminalCols] = useState(process.stdout.columns || 100);
  const [backendRunning, setBackendRunning] = useState(false);
  const [frontendRunning, setFrontendRunning] = useState(false);
  const [backendReady, setBackendReady] = useState(false);
  const [frontendReady, setFrontendReady] = useState(false);
  const [focusedBtn, setFocusedBtn] = useState(-1);
  const [startedAt] = useState(() => Date.now());
  const [now, setNow] = useState(() => Date.now());

  // biome-ignore lint/suspicious/noExplicitAny: Bun.spawn return type contains any internally
  const backendProcessRef = useRef<ReturnType<typeof Bun.spawn> | null>(null);
  // biome-ignore lint/suspicious/noExplicitAny: Bun.spawn return type contains any internally
  const frontendProcessRef = useRef<ReturnType<typeof Bun.spawn> | null>(null);

  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, []);

  useEffect(() => {
    const handleResize = () => {
      setTerminalRows(process.stdout.rows || 24);
      setTerminalCols(process.stdout.columns || 100);
    };
    process.stdout.on("resize", handleResize);
    return () => {
      process.stdout.off("resize", handleResize);
    };
  }, []);

  const headerHeight = 5;
  const footerHeight = 3;
  const layoutOverhead = 4;
  const maxLogs = Math.max(5, terminalRows - headerHeight - footerHeight - layoutOverhead);

  const maxLogsRef = useRef(maxLogs);
  useEffect(() => {
    maxLogsRef.current = maxLogs;
  }, [maxLogs]);

  const isInteractive = process.stdin.isTTY && typeof process.stdin.setRawMode === "function";

  const pipeToState = (
    stream: ReadableStream<Uint8Array> | null,
    setLogs: React.Dispatch<React.SetStateAction<string[]>>,
    setScroll: React.Dispatch<React.SetStateAction<number>>,
    isBackend: boolean,
  ) => {
    if (!stream) return;
    const rl = createInterface({
      input: Readable.fromWeb(stream),
      terminal: false,
    });

    rl.on("line", (line) => {
      let cleaned = line.replace(/\r/g, "");
      const plain = stripAnsi(cleaned);

      if (isBackend && /listening on|ready on|http:\/\/localhost:3000/i.test(plain)) {
        setBackendReady(true);
      }
      if (!isBackend && /astro|localhost:4321|ready in/i.test(plain)) {
        setFrontendReady(true);
      }

      if (isBackend && cleaned.includes("[ERROR] [SEVERITY:")) {
        if (cleaned.includes("[SEVERITY:LOW]")) {
          setErrorsCount((prev) => ({ ...prev, low: prev.low + 1 }));
        } else if (cleaned.includes("[SEVERITY:MEDIUM]")) {
          setErrorsCount((prev) => ({ ...prev, medium: prev.medium + 1 }));
        } else if (cleaned.includes("[SEVERITY:HIGH]")) {
          setErrorsCount((prev) => ({ ...prev, high: prev.high + 1 }));
        }
        cleaned = cleaned.replace(/\[ERROR\] \[SEVERITY:(LOW|MEDIUM|HIGH)\] /, "");
      }

      setLogs((prev) => {
        const next = [...prev, cleaned].slice(-1000);
        setScroll((scroll) =>
          scroll > 0 ? Math.min(next.length - maxLogsRef.current, scroll + 1) : 0,
        );
        return next;
      });
    });
  };

  const startBackend = () => {
    if (backendProcessRef.current) {
      try {
        backendProcessRef.current.kill();
      } catch (e) {}
    }
    setBackendReady(false);
    setBackendLogs((prev) => [...prev, "  → starting backend…"]);
    const proc = Bun.spawn(["bun", "--cwd", "backend", "dev"], {
      stdout: "pipe",
      stderr: "pipe",
      env,
    });
    backendProcessRef.current = proc;
    activeProcesses.backend = proc;
    setBackendRunning(true);

    pipeToState(proc.stdout, setBackendLogs, setBackendScroll, true);
    pipeToState(proc.stderr, setBackendLogs, setBackendScroll, true);
  };

  const startFrontend = () => {
    if (frontendProcessRef.current) {
      try {
        frontendProcessRef.current.kill();
      } catch (e) {}
    }
    setFrontendReady(false);
    setFrontendLogs((prev) => [...prev, "  → starting frontend…"]);
    const proc = Bun.spawn(["bun", "--cwd", "frontend", "dev"], {
      stdout: "pipe",
      stderr: "pipe",
      env,
    });
    frontendProcessRef.current = proc;
    activeProcesses.frontend = proc;
    setFrontendRunning(true);

    pipeToState(proc.stdout, setFrontendLogs, setFrontendScroll, false);
    pipeToState(proc.stderr, setFrontendLogs, setFrontendScroll, false);
  };

  const restartAll = async () => {
    setBackendLogs((prev) => [...prev, "  ↻ restarting…"]);
    setFrontendLogs((prev) => [...prev, "  ↻ restarting…"]);
    if (backendProcessRef.current) {
      try {
        backendProcessRef.current.kill();
      } catch (e) {}
      backendProcessRef.current = null;
      activeProcesses.backend = null;
    }
    if (frontendProcessRef.current) {
      try {
        frontendProcessRef.current.kill();
      } catch (e) {}
      frontendProcessRef.current = null;
      activeProcesses.frontend = null;
    }
    setBackendRunning(false);
    setFrontendRunning(false);
    setBackendReady(false);
    setFrontendReady(false);
    await Bun.sleep(400);
    startBackend();
    startFrontend();
  };

  const clearLogs = () => {
    setBackendLogs([]);
    setFrontendLogs([]);
    setBackendScroll(0);
    setFrontendScroll(0);
  };

  useEffect(() => {
    startBackend();
    startFrontend();
    return () => {
      if (backendProcessRef.current) backendProcessRef.current.kill();
      if (frontendProcessRef.current) frontendProcessRef.current.kill();
    };
  }, []);

  const getVisibleLogs = (logs: string[], scrollIndex: number) => {
    const start = Math.max(0, logs.length - maxLogs - scrollIndex);
    const end = logs.length - scrollIndex;
    return logs.slice(start, end);
  };

  const visibleBackend = getVisibleLogs(backendLogs, backendScroll);
  const visibleFrontend = getVisibleLogs(frontendLogs, frontendScroll);
  const uptimeSec = Math.floor((now - startedAt) / 1000);
  const wide = terminalCols >= 110;

  return (
    <Box flexDirection="column" height={terminalRows} paddingX={1} paddingY={0}>
      {isInteractive && (
        <KeyboardListener
          maxLogs={maxLogs}
          backendLogsCount={backendLogs.length}
          frontendLogsCount={frontendLogs.length}
          setBackendScroll={setBackendScroll}
          setFrontendScroll={setFrontendScroll}
          focusedBtn={focusedBtn}
          setFocusedBtn={setFocusedBtn}
          onRestartAll={restartAll}
          onClearLogs={clearLogs}
          onStopAll={cleanup}
        />
      )}

      {/* Header */}
      <Box flexDirection="column" marginBottom={1}>
        <Box justifyContent="space-between" paddingX={1}>
          <Box>
            <Text color="cyan" bold>nexora</Text>
            <Text color="gray"> · dev</Text>
            <Text color="gray" dimColor>{"   "}</Text>
            <Text color="gray" dimColor>{fmtTime(new Date(now))}</Text>
            <Text color="gray" dimColor>{"  ·  uptime "}</Text>
            <Text color="gray">{fmtUptime(uptimeSec)}</Text>
          </Box>
          <Box>
            <Text color="gray" dimColor>{"errors  "}</Text>
            <Text color={errorsCount.low > 0 ? "yellow" : "gray"}>{errorsCount.low}</Text>
            <Text color="gray" dimColor>{" low  "}</Text>
            <Text color={errorsCount.medium > 0 ? "yellow" : "gray"} bold={errorsCount.medium > 0}>{errorsCount.medium}</Text>
            <Text color="gray" dimColor>{" med  "}</Text>
            <Text color={errorsCount.high > 0 ? "red" : "gray"} bold={errorsCount.high > 0}>{errorsCount.high}</Text>
            <Text color="gray" dimColor>{" high"}</Text>
          </Box>
        </Box>
        <Box paddingX={1}>
          <Text color="gray" dimColor>{"─".repeat(Math.max(20, terminalCols - 4))}</Text>
        </Box>
        <Box justifyContent="space-between" paddingX={1}>
          <Box>
            <StatusDot ready={backendReady} running={backendRunning} />
            <Text color="gray">{"  api      "}</Text>
            <Text color="white">http://localhost:3000</Text>
            <Text color="gray" dimColor>{"   "}</Text>
            <StatusText ready={backendReady} running={backendRunning} />
          </Box>
          <Box>
            <StatusDot ready={frontendReady} running={frontendRunning} />
            <Text color="gray">{"  web      "}</Text>
            <Text color="white">http://localhost:4321</Text>
            <Text color="gray" dimColor>{"   "}</Text>
            <StatusText ready={frontendReady} running={frontendRunning} />
          </Box>
        </Box>
      </Box>

      {/* Panels */}
      <Box flexDirection={wide ? "row" : "column"} flexGrow={1}>
        <Box
          flexDirection="column"
          width={wide ? "50%" : "100%"}
          borderStyle="round"
          borderColor={backendReady ? "cyan" : "gray"}
          paddingX={1}
          marginRight={wide ? 1 : 0}
          marginBottom={wide ? 0 : 1}
        >
          <Box justifyContent="space-between">
            <Box>
              <Text color="cyan" bold>api</Text>
              <Text color="gray" dimColor>{"  ·  backend"}</Text>
            </Box>
            {backendScroll > 0
              ? <Text color="yellow">↑ scrolled · w/s</Text>
              : <Text color="gray" dimColor>{backendLogs.length} lines</Text>}
          </Box>
          <Box flexDirection="column" flexGrow={1} marginTop={1}>
            {visibleBackend.map((log, i) => <Text key={i} wrap="truncate">{log}</Text>)}
          </Box>
        </Box>

        <Box
          flexDirection="column"
          width={wide ? "50%" : "100%"}
          borderStyle="round"
          borderColor={frontendReady ? "magenta" : "gray"}
          paddingX={1}
        >
          <Box justifyContent="space-between">
            <Box>
              <Text color="magenta" bold>web</Text>
              <Text color="gray" dimColor>{"  ·  frontend"}</Text>
            </Box>
            {frontendScroll > 0
              ? <Text color="yellow">↑ scrolled · ↑/↓</Text>
              : <Text color="gray" dimColor>{frontendLogs.length} lines</Text>}
          </Box>
          <Box flexDirection="column" flexGrow={1} marginTop={1}>
            {visibleFrontend.map((log, i) => <Text key={i} wrap="truncate">{log}</Text>)}
          </Box>
        </Box>
      </Box>

      {/* Footer */}
      <Box marginTop={1} paddingX={1} justifyContent="space-between">
        <Box>
          <FooterKey label="restart" hotkey="r" focused={focusedBtn === 0} accent="cyan" />
          <Text>{"   "}</Text>
          <FooterKey label="clear" hotkey="c" focused={focusedBtn === 1} accent="yellow" />
          <Text>{"   "}</Text>
          <FooterKey label="quit" hotkey="q" focused={focusedBtn === 2} accent="red" />
        </Box>
        <Box>
          <Text color="gray" dimColor>tab cycles · enter activates</Text>
        </Box>
      </Box>
    </Box>
  );
};

const { waitUntilExit } = render(<DevRunner />);

process.on("SIGINT", cleanup);
process.on("SIGTERM", cleanup);
process.on("exit", cleanup);

await waitUntilExit();
cleanup();