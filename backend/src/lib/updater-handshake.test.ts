import { describe, expect, it, beforeEach, afterEach } from "bun:test";
import { signRequest, verifyRequest, HEADER_TS, HEADER_NONCE, HEADER_AUTH } from "./updater-handshake.ts";

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
});