/**
 * Catbox.moe uploader — shares a file from the customer's userspace to a
 * public catbox.moe URL.
 *
 * Why catbox? Customer's request: "support catbox để upload file qua catbox
 * mà export ra dạng link". Catbox is free, no-account, returns a permanent
 * direct URL, and doesn't require signed S3-style headers.
 *
 * Safety:
 * - Caller must supply already-jailed bytes (see lib/tenant.ts → jailUserspace).
 *   This module trusts its input — it does NOT re-validate paths.
 * - Size cap: catbox.moe rejects > 200 MB. We refuse earlier (50 MB) to keep
 *   admin UI snappy; raise if a customer needs more.
 * - MIME whitelist enforced by callers (the file-tree route). This module is
 *   transport only.
 *
 * Auth modes:
 * - Anonymous (default) — file uploads count against catbox's anon quota
 *   and CANNOT be deleted by us later. Use for non-sensitive exports.
 * - Userhash — pass CATBOX_USERHASH; uploads attach to that account so the
 *   maintainer can delete via catbox's dashboard. Userhash is NOT a secret
 *   in the cryptographic sense (catbox shows it to logged-in users on
 *   /user/manage.php), but it does authorize deletion, so keep it out of
 *   logs and only ship it via env var.
 */

const ENDPOINT = "https://catbox.moe/user/api.php";
const MAX_BYTES = 50 * 1024 * 1024;
const DEFAULT_TIMEOUT_MS = 60_000;

export interface CatboxUploadResult {
  url: string;
  bytes: number;
  filename: string;
  elapsedMs: number;
}

export interface CatboxUploadOptions {
  /** Optional override; default reads CATBOX_USERHASH env. Empty string = anonymous. */
  userhash?: string;
  /** Override default 60s timeout for slow links / large files. */
  timeoutMs?: number;
  /** Override the public catbox endpoint (test injection only). */
  endpoint?: string;
}

/**
 * Upload a buffer to catbox.moe and return the public URL.
 *
 * @throws if the buffer exceeds MAX_BYTES or catbox returns a non-200/non-URL body.
 */
export async function uploadBufferToCatbox(
  filename: string,
  bytes: Uint8Array,
  opts: CatboxUploadOptions = {},
): Promise<CatboxUploadResult> {
  if (!filename || typeof filename !== "string") {
    throw new Error("catbox: filename required");
  }
  if (bytes.byteLength === 0) {
    throw new Error("catbox: refusing to upload empty file");
  }
  if (bytes.byteLength > MAX_BYTES) {
    throw new Error(
      `catbox: file too large (${bytes.byteLength} > ${MAX_BYTES} bytes)`,
    );
  }
  const safeName = sanitizeFilename(filename);
  const userhash = opts.userhash ?? Bun.env.CATBOX_USERHASH ?? "";
  const endpoint = opts.endpoint ?? ENDPOINT;
  const timeoutMs = opts.timeoutMs ?? DEFAULT_TIMEOUT_MS;

  const form = new FormData();
  form.append("reqtype", "fileupload");
  if (userhash) form.append("userhash", userhash);
  form.append(
    "fileToUpload",
    new Blob([bytes as BlobPart], { type: "application/octet-stream" }),
    safeName,
  );

  const t0 = Date.now();
  const r = await fetch(endpoint, {
    method: "POST",
    body: form,
    signal: AbortSignal.timeout(timeoutMs),
  });
  const elapsedMs = Date.now() - t0;

  // Catbox returns the URL as plain text on 200, or a plain-text error
  // (sometimes wrapped in HTML) on failure. Be lenient when parsing.
  const text = (await r.text()).trim();
  if (!r.ok) {
    throw new Error(`catbox: HTTP ${r.status} — ${truncate(text, 200)}`);
  }
  if (!isCatboxUrl(text)) {
    throw new Error(`catbox: unexpected response — ${truncate(text, 200)}`);
  }
  return {
    url: text,
    bytes: bytes.byteLength,
    filename: safeName,
    elapsedMs,
  };
}

/** Strip path separators and control chars; catbox stores the basename only. */
function sanitizeFilename(name: string): string {
  // Take basename only — never let "../foo" or "C:\bar" through.
  const base = name.split(/[/]/).pop() ?? "file";
  // Catbox accepts most chars but control chars + null cause weird display
  // in their gallery. Replace with underscore. Cap length at 100 to fit URL.
  const cleaned = base.replace(/[\x00-\x1f\x7f]/g, "_").slice(0, 100);
  return cleaned.length > 0 ? cleaned : "file";
}

/** Catbox URLs are always `https://files.catbox.moe/<6-8 chars>.<ext>`. */
export function isCatboxUrl(s: string): boolean {
  return /^https:\/\/files\.catbox\.moe\/[a-z0-9]{4,10}(?:\.[a-z0-9]{1,8})?$/i.test(s);
}

function truncate(s: string, n: number): string {
  return s.length > n ? `${s.slice(0, n)}…` : s;
}

export const CATBOX_MAX_BYTES = MAX_BYTES;