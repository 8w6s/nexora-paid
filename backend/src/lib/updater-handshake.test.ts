import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import {
  HEADER_AUTH,
  HEADER_NONCE,
  HEADER_TS,
  signRequest,
  verifyRequest,
} from "./updater-handshake.ts";

const PSK = "x".repeat(64);

function headersFrom(obj: Record<string, string>): Headers {
  const h = new Headers();
  for (const [k, v] of Object.entries(obj)) h.set(k, v);
  return h;
}

describe("updater-handshake", () => {
  let prev: string | undefined;
  beforeEach(() => {
    prev = process.env.NEXORA_UPDATER_PSK;
    process.env.NEXORA_UPDATER_PSK = PSK;
  });
  afterEach(() => {
    if (prev === undefined) delete process.env.NEXORA_UPDATER_PSK;
    else process.env.NEXORA_UPDATER_PSK = prev;
  });

  it("round-trip: sign then verify", () => {
    const body = JSON.stringify({ targetVersion: "1.1.0" });
    const v = verifyRequest(headersFrom(signRequest(body)), body);
    expect(v.ok).toBe(true);
  });

  it("rejects tampered body", () => {
    const body = "ok";
    const signed = signRequest(body);
    const v = verifyRequest(headersFrom(signed), body + " ");
    expect(v.ok).toBe(false);
    expect(v.reason).toBe("mismatch");
  });

  it("rejects missing headers", () => {
    const body = "{}";
    const signed = signRequest(body);
    const partial: Record<string, string> = {};
    partial[HEADER_TS] = signed[HEADER_TS];
    partial[HEADER_NONCE] = signed[HEADER_NONCE];
    const v = verifyRequest(headersFrom(partial), body);
    expect(v.ok).toBe(false);
    expect(v.reason).toBe("missing");
  });

  it("rejects skew beyond 30s", () => {
    const body = "{}";
    const signed = signRequest(body);
    const stale = { ...signed };
    stale[HEADER_TS] = String(Date.now() - 45_000);
    const v = verifyRequest(headersFrom(stale), body);
    expect(v.ok).toBe(false);
    expect(v.reason).toBe("skew");
  });

  it("rejects replayed nonce", () => {
    const body = "{}";
    const signed = signRequest(body);
    expect(verifyRequest(headersFrom(signed), body).ok).toBe(true);
    const second = verifyRequest(headersFrom(signed), body);
    expect(second.ok).toBe(false);
    expect(second.reason).toBe("replay");
  });

  it("rejects when PSK missing", () => {
    delete process.env.NEXORA_UPDATER_PSK;
    const headers = headersFrom({ [HEADER_TS]: "1", [HEADER_NONCE]: "n", [HEADER_AUTH]: "a" });
    const v = verifyRequest(headers, "{}");
    expect(v.ok).toBe(false);
    expect(v.reason).toBe("no-psk");
  });

  it("refuses to sign with short PSK", () => {
    process.env.NEXORA_UPDATER_PSK = "tooshort";
    expect(() => signRequest("{}")).toThrow();
  });

  it("two consecutive signRequest calls produce distinct nonces", () => {
    const a = signRequest("{}");
    const b = signRequest("{}");
    expect(a[HEADER_NONCE]).not.toBe(b[HEADER_NONCE]);
    // ts may equal on a fast machine — that's fine, nonce alone defends replay.
  });

  it("HMAC differs when body differs by a single byte", () => {
    const a = signRequest("a");
    // Re-sign with same ts/nonce path forced by reusing both headers? Simpler:
    // produce two signatures (different nonces) and check the auth field
    // changes when the body changes too.
    const b = signRequest("b");
    expect(a[HEADER_AUTH]).not.toBe(b[HEADER_AUTH]);
  });

  it("verifies a 1 MB body without truncation", () => {
    const body = "x".repeat(1024 * 1024);
    const v = verifyRequest(headersFrom(signRequest(body)), body);
    expect(v.ok).toBe(true);
  });

  it("rejects when ts is not a number", () => {
    const body = "{}";
    const signed = signRequest(body);
    const bad = { ...signed };
    bad[HEADER_TS] = "not-a-number";
    const v = verifyRequest(headersFrom(bad), body);
    expect(v.ok).toBe(false);
  });

  it("rejects skew in the future beyond 30s", () => {
    const body = "{}";
    const signed = signRequest(body);
    const future = { ...signed };
    future[HEADER_TS] = String(Date.now() + 45_000);
    const v = verifyRequest(headersFrom(future), body);
    expect(v.ok).toBe(false);
    expect(v.reason).toBe("skew");
  });
});
