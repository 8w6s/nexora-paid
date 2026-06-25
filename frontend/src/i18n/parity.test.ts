/**
 * i18n key-parity test.
 *
 * Roadmap item 17 — every locale must have exactly the same key set as en.json.
 * A drift here is almost always accidental (a dev added a key but forgot to
 * translate it, or removed one only from some files). CI failure forces the
 * fix to land alongside the change instead of silently shipping fallbacks.
 *
 * If a key truly should exist in only one locale, edit en.json to match —
 * en is the canonical source of truth.
 */
import { describe, expect, it } from "bun:test";
import de from "./locales/de.json";
import en from "./locales/en.json";
import es from "./locales/es.json";
import vi from "./locales/vi.json";
import zh from "./locales/zh.json";

type Bag = Record<string, unknown>;

function collectKeys(obj: unknown, prefix = ""): string[] {
  if (!obj || typeof obj !== "object" || Array.isArray(obj)) return [];
  const out: string[] = [];
  for (const [k, v] of Object.entries(obj as Bag)) {
    const path = prefix ? `${prefix}.${k}` : k;
    if (v && typeof v === "object" && !Array.isArray(v)) {
      out.push(...collectKeys(v, path));
    } else {
      out.push(path);
    }
  }
  return out;
}

const LOCALES: Array<[string, unknown]> = [
  ["vi", vi],
  ["zh", zh],
  ["es", es],
  ["de", de],
];

describe("i18n key parity vs en", () => {
  const baseKeys = new Set(collectKeys(en));

  it("en has at least one key (sanity)", () => {
    expect(baseKeys.size).toBeGreaterThan(0);
  });

  for (const [name, bag] of LOCALES) {
    it(`${name} has the same key set as en`, () => {
      const here = new Set(collectKeys(bag));
      const missing = [...baseKeys].filter((k) => !here.has(k));
      const extra = [...here].filter((k) => !baseKeys.has(k));
      // Surface BOTH sides in one failure so a drift caught in CI tells
      // the contributor exactly what to add or remove.
      expect({ locale: name, missing, extra }).toEqual({
        locale: name,
        missing: [],
        extra: [],
      });
    });
  }
});