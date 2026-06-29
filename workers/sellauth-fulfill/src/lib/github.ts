/**
 * Minimal GitHub Contents API client — just enough to append one line
 * to customers.txt and commit. Uses optimistic concurrency via the file's
 * sha; retries once on 409 (someone else committed between read + write).
 */
import { base64ToBytes, bytesToBase64 } from "./crypto.ts";

interface GhFileResponse {
  content: string;
  sha: string;
  encoding: "base64";
}

export interface AppendOptions {
  repo: string; // "owner/name"
  branch: string;
  path: string;
  newLine: string;
  message: string;
  pat: string;
}

const dec = new TextDecoder("utf-8");

function ghHeaders(pat: string): HeadersInit {
  return {
    accept: "application/vnd.github+json",
    authorization: `Bearer ${pat}`,
    "user-agent": "nexora-sellauth-fulfill",
    "x-github-api-version": "2022-11-28",
  };
}

async function readFile(opts: AppendOptions): Promise<GhFileResponse | null> {
  const url = `https://api.github.com/repos/${opts.repo}/contents/${encodeURIComponent(opts.path)}?ref=${encodeURIComponent(opts.branch)}`;
  const r = await fetch(url, { headers: ghHeaders(opts.pat) });
  if (r.status === 404) return null; // file doesn't exist yet — first commit
  if (!r.ok) throw new Error(`gh read ${r.status}: ${await r.text()}`);
  return (await r.json()) as GhFileResponse;
}

async function writeFile(
  opts: AppendOptions,
  content: string,
  sha: string | undefined,
): Promise<void> {
  const url = `https://api.github.com/repos/${opts.repo}/contents/${encodeURIComponent(opts.path)}`;
  const body: Record<string, unknown> = {
    message: opts.message,
    content: bytesToBase64(new TextEncoder().encode(content)),
    branch: opts.branch,
  };
  if (sha) body.sha = sha;
  const r = await fetch(url, {
    method: "PUT",
    headers: { ...ghHeaders(opts.pat), "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!r.ok) {
    const t = await r.text();
    throw new Error(`gh write ${r.status}: ${t}`);
  }
}

/**
 * Append `newLine` to `path` and commit. Retries once on 409/conflict
 * (rare — would mean two webhooks fire simultaneously). After the second
 * conflict we bail; the customer's purchase still triggered the SellAuth
 * delivery (with a usable license), so manual reconciliation = paste the
 * one missed line by hand later.
 */
export async function appendLineToFile(opts: AppendOptions): Promise<void> {
  for (let attempt = 0; attempt < 2; attempt++) {
    const cur = await readFile(opts);
    const currentText = cur ? dec.decode(base64ToBytes(cur.content)) : "";
    // Strip trailing whitespace, ensure exactly one trailing newline.
    const trimmed = currentText.replace(/\s+$/, "");
    const next = `${trimmed}${trimmed ? "\n" : ""}${opts.newLine}\n`;
    try {
      await writeFile(opts, next, cur?.sha);
      return;
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      // Conflict → re-read sha, retry once.
      if (attempt === 0 && /\b409\b|sha/i.test(msg)) continue;
      throw e;
    }
  }
}