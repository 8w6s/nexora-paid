// Pre-boot banner: in mot lan, hien spinner trong khi opentui dang load.
// Khi opentui take over no se clear man hinh.

const ESC = String.fromCharCode(27);
const NL = String.fromCharCode(10);
const OUT = (s: string) => process.stdout.write(s);

// Khong bat alt screen - opentui se tu quan ly. Chi clear + hide cursor.
OUT(`${ESC}[?25l${ESC}[2J${ESC}[H`);

const NEXORA = [
  " █▀█ █▀▀ █ █ █▀█ █▀▄ █▀█   █▀█ █▀█ █▀█ █▀▀ █  ",
  " █ █ █▀▀ ▄▀▄ █ █ █▀▄ █▀█   █▀▀ █▀█ █ █ █▀▀ █  ",
  " ▀ ▀ ▀▀▀ ▀ ▀ ▀▀▀ ▀ ▀ ▀ ▀   ▀   ▀ ▀ ▀ ▀ ▀▀▀ ▀▀▀",
];
const SUB = "— digital goods storefront —";
const LOGO_W = 47;

const fg = (r: number, g: number, b: number) => `${ESC}[38;2;${r};${g};${b}m`;
const BLUE = fg(70, 130, 220);
const CYAN = fg(0, 220, 255);
const STAR = fg(237, 220, 170);
const DIM = fg(120, 120, 130);
const MUTED = fg(80, 80, 90);
const RESET = `${ESC}[0m`;
const BOLD = `${ESC}[1m`;

const cols = process.stdout.columns ?? 80;
const rows = process.stdout.rows ?? 24;
const padLeft = Math.max(0, Math.floor((cols - LOGO_W) / 2));
const PAD = " ".repeat(padLeft);
const subPad = " ".repeat(Math.max(0, Math.floor((cols - SUB.length) / 2)));

function paintBanner() {
  OUT(`${ESC}[H${ESC}[2J`);
  const topPad = Math.max(1, Math.floor((rows - 8) / 2));
  for (let i = 0; i < topPad; i++) OUT(NL);
  for (const line of NEXORA) {
    let buf = PAD;
    for (const ch of line) buf += ch === " " ? " " : `${BLUE}${BOLD}${ch}${RESET}`;
    OUT(buf + NL);
  }
  OUT(`${subPad}${MUTED}${SUB}${RESET}${NL}${NL}`);
}

// Spinner kieu sao: pulse expand-contract - ".", "·", "✦", "✶", "✺", "✶", "✦", "·"
// tao cam giac mot ngoi sao "tho" ra-hit, hop voi theme vu tru cua dashboard.
const SPIN = [".", "·", "✦", "✶", "✺", "✶", "✦", "·"];
const STATUS_MSGS = [
  "warming up backend",
  "lighting up frontend",
  "tuning telemetry",
  "almost there",
];
let spinFrame = 0;
let statusIdx = 0;
let spinTimer: ReturnType<typeof setInterval> | null = null;
let statusTimer: ReturnType<typeof setInterval> | null = null;

function paintStatusLine() {
  const sp = SPIN[spinFrame % SPIN.length];
  const msg = STATUS_MSGS[statusIdx % STATUS_MSGS.length];
  const text = `${sp}  ${msg}…`;
  const sPad = " ".repeat(Math.max(0, Math.floor((cols - text.length) / 2)));
  OUT(`\r${ESC}[2K${sPad}${CYAN}${sp}${RESET}  ${DIM}${msg}…${RESET}`);
}

function startSpinner() {
  paintStatusLine();
  spinTimer = setInterval(() => {
    spinFrame++;
    paintStatusLine();
  }, 90);
  statusTimer = setInterval(() => {
    statusIdx++;
  }, 900);
}

function stopSpinner() {
  if (spinTimer) clearInterval(spinTimer);
  if (statusTimer) clearInterval(statusTimer);
  spinTimer = null;
  statusTimer = null;
}

let cleanedUp = false;
const earlyCleanup = () => {
  if (cleanedUp) return;
  cleanedUp = true;
  stopSpinner();
  OUT(`${RESET}${ESC}[?25h${ESC}[?1049l`);
};
process.on("SIGINT", () => {
  earlyCleanup();
  process.exit(130);
});
process.on("SIGTERM", () => {
  earlyCleanup();
  process.exit(143);
});

async function main() {
  paintBanner();
  startSpinner();
  // Cho spinner hien thi mot luc de user thay banner -> transition.
  await new Promise<void>((r) => setTimeout(r, 800));
  // STOP SPINNER TRUOC khi import opentui. Truoc day spinner setInterval va
  // opentui renderer cung ghi stdout cung luc -> ANSI sequences interleave
  // -> opentui native dll segfault tren Windows (Bun 1.3.x). Bay gio chi
  // mot writer tai mot thoi diem.
  stopSpinner();
  // Clear man hinh sach truoc khi opentui take over de tranh ghost text.
  OUT(`${ESC}[2J${ESC}[H`);
  await import("./tui/index");
}

main().catch((e) => {
  earlyCleanup();
  console.error(e);
  process.exit(1);
});