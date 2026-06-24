/**
 * paymentDecision smoke tests. This is the pure function that turns an
 * AddrStatus + order expected/tolerance/confirmations into the verdict the
 * watcher acts on. Every payment-correctness branch routes through here, so
 * regressions here = real customer-facing money bugs.
 *
 * Covered:
 *   - paid       (enough amount + enough confirmations)
 *   - underpaid  (some received but below expected − tolerance)
 *   - waiting    (nothing on-chain yet, or seen-but-unconfirmed)
 *   - tolerance boundary (exact / ±1 around threshold)
 *   - cumulative top-up (underpaid → paid after additional deposit)
 *   - confirmations-not-yet-enough does NOT downgrade past "paid" threshold
 */
import { describe, expect, test } from "bun:test";
import { type AddrStatus, paymentDecision } from "./explorer.ts";

function status(receivedLitoshi: number, maxConfirmations = 0, pendingLitoshi = 0): AddrStatus {
  return { receivedLitoshi, pendingLitoshi, maxConfirmations };
}

describe("paymentDecision", () => {
  const EXPECTED = 100_000_000; // 1 LTC
  const TOL = 1_000; // 0.00001 LTC slack for fee jitter
  const REQ_CONF = 2;

  test("paid: exact amount + enough confirmations", () => {
    expect(paymentDecision(status(EXPECTED, REQ_CONF), EXPECTED, REQ_CONF, TOL)).toBe("paid");
  });

  test("paid: over by a hair + enough confirmations", () => {
    expect(paymentDecision(status(EXPECTED + 50_000, REQ_CONF), EXPECTED, REQ_CONF, TOL)).toBe(
      "paid",
    );
  });

  test("paid: short by exactly tolerance, still paid (boundary)", () => {
    expect(paymentDecision(status(EXPECTED - TOL, REQ_CONF), EXPECTED, REQ_CONF, TOL)).toBe("paid");
  });

  test("underpaid: short by tolerance + 1 satoshi → underpaid", () => {
    expect(paymentDecision(status(EXPECTED - TOL - 1, REQ_CONF), EXPECTED, REQ_CONF, TOL)).toBe(
      "underpaid",
    );
  });

  test("underpaid: large partial payment", () => {
    expect(paymentDecision(status(EXPECTED / 2, REQ_CONF), EXPECTED, REQ_CONF, TOL)).toBe(
      "underpaid",
    );
  });

  test("waiting: nothing received yet", () => {
    expect(paymentDecision(status(0, 0), EXPECTED, REQ_CONF, TOL)).toBe("waiting");
  });

  test("waiting: enough amount but not enough confirmations (mempool-only)", () => {
    // receivedLitoshi cumulative confirmed; confirmations < required means
    // the funding tx isn't deep enough yet — do NOT mark paid.
    expect(paymentDecision(status(EXPECTED, 0), EXPECTED, REQ_CONF, TOL)).toBe("waiting");
  });

  test("waiting: enough amount but 1 confirmation short of required", () => {
    expect(paymentDecision(status(EXPECTED, REQ_CONF - 1), EXPECTED, REQ_CONF, TOL)).toBe(
      "waiting",
    );
  });

  test("underpaid → paid after top-up (cumulative receivedLitoshi)", () => {
    // Half paid, any conf: received>0 and below threshold → underpaid (the
    // verdict ignores confirmations once received is non-zero-and-short — the
    // operator wants to surface partial payments immediately, not wait for them
    // to confirm).
    expect(paymentDecision(status(EXPECTED / 2, 0), EXPECTED, REQ_CONF, TOL)).toBe("underpaid");
    expect(paymentDecision(status(EXPECTED / 2, REQ_CONF), EXPECTED, REQ_CONF, TOL)).toBe(
      "underpaid",
    );
    // Customer tops up: cumulative total now meets expected, confirmed → paid.
    expect(paymentDecision(status(EXPECTED, REQ_CONF), EXPECTED, REQ_CONF, TOL)).toBe("paid");
  });

  test("zero tolerance: exact match works", () => {
    expect(paymentDecision(status(EXPECTED, REQ_CONF), EXPECTED, REQ_CONF, 0)).toBe("paid");
  });

  test("zero tolerance: 1 satoshi short → underpaid", () => {
    expect(paymentDecision(status(EXPECTED - 1, REQ_CONF), EXPECTED, REQ_CONF, 0)).toBe(
      "underpaid",
    );
  });

  test("zero-confirmation requirement: 0/0 received → waiting (no funds)", () => {
    expect(paymentDecision(status(0, 0), EXPECTED, 0, TOL)).toBe("waiting");
  });

  test("zero-confirmation requirement: full amount at 0 conf → paid", () => {
    // Operator can set required_confirmations=0 for low-value goods. Honor it.
    expect(paymentDecision(status(EXPECTED, 0), EXPECTED, 0, TOL)).toBe("paid");
  });
});