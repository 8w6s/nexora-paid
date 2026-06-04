/**
 * Shared CSV utilities for Paid export endpoints.
 *
 * Hoisted out of admin-export.ts in iter 10 when admin-customers-csv.ts
 * needed the same RFC-4180 escape + filename-stamp logic.
 */

// RFC-4180 cell escape: ALWAYS quote, double inner quotes. Cells stay
// intact across spreadsheet apps even when they contain commas, line
// breaks, or leading/trailing whitespace.
export function csvCell(v: unknown): string {
  if (v === null || v === undefined) return "";
  const s = v instanceof Date ? v.toISOString() : String(v);
  return `"${s.replace(/"/g, '""')}"`;
}

// UTC `YYYY-MM-DD` stamp for export filenames. UTC so two admins in
// different timezones get the same filename for the same export.
export function todayStamp(now: Date): string {
  const y = now.getUTCFullYear();
  const m = String(now.getUTCMonth() + 1).padStart(2, "0");
  const d = String(now.getUTCDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

// Assemble a full CSV body from columns + rows. Header line + CRLF +
// joined rows + trailing CRLF (some tools expect newline-terminated).
export function csvBody<C extends string>(columns: readonly C[], rows: Record<string, unknown>[]): string {
  const header = columns.join(",");
  const body = rows.map((r) => columns.map((col) => csvCell(r[col])).join(",")).join("\r\n");
  return `${header}\r\n${body}${rows.length ? "\r\n" : ""}`;
}
