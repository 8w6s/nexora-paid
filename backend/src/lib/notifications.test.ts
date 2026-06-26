import { describe, expect, test } from "bun:test";
import { isSafeWebhookUrl } from "./notifications.ts";

describe("isSafeWebhookUrl — SSRF guard (f-notif-1)", () => {
  test("accepts a public https URL", () => {
    expect(isSafeWebhookUrl("https://example.com/hook")).toBe(true);
    expect(isSafeWebhookUrl("https://api.acme.io/path?q=1")).toBe(true);
  });

  test("refuses http (plaintext) — must be https", () => {
    expect(isSafeWebhookUrl("http://example.com/hook")).toBe(false);
  });

  test("refuses non-URL strings", () => {
    expect(isSafeWebhookUrl("")).toBe(false);
    expect(isSafeWebhookUrl("not a url")).toBe(false);
    expect(isSafeWebhookUrl("javascript:alert(1)")).toBe(false);
    expect(isSafeWebhookUrl("file:///etc/passwd")).toBe(false);
  });

  test("refuses loopback hosts (127.x, localhost, ::1)", () => {
    expect(isSafeWebhookUrl("https://localhost/hook")).toBe(false);
    expect(isSafeWebhookUrl("https://127.0.0.1/hook")).toBe(false);
    expect(isSafeWebhookUrl("https://127.255.255.255/hook")).toBe(false);
    expect(isSafeWebhookUrl("https://[::1]/hook")).toBe(false);
  });

  test("refuses RFC1918 private ranges (the SSRF classics)", () => {
    expect(isSafeWebhookUrl("https://10.0.0.1/hook")).toBe(false);
    expect(isSafeWebhookUrl("https://10.255.255.255/hook")).toBe(false);
    expect(isSafeWebhookUrl("https://192.168.1.1/hook")).toBe(false);
    expect(isSafeWebhookUrl("https://172.16.0.1/hook")).toBe(false);
    expect(isSafeWebhookUrl("https://172.31.255.255/hook")).toBe(false);
  });

  test("refuses link-local + cloud metadata (169.254.x)", () => {
    expect(isSafeWebhookUrl("https://169.254.169.254/latest/meta-data/")).toBe(false);
    expect(isSafeWebhookUrl("https://169.254.0.1/")).toBe(false);
  });

  test("refuses 0.x.x.x ('this network')", () => {
    expect(isSafeWebhookUrl("https://0.0.0.0/")).toBe(false);
  });

  test("refuses IPv6 link-local + ULA", () => {
    expect(isSafeWebhookUrl("https://[fe80::1]/")).toBe(false);
    expect(isSafeWebhookUrl("https://[fc00::1]/")).toBe(false);
    expect(isSafeWebhookUrl("https://[fd00::1]/")).toBe(false);
  });

  test("allowOnlyHost option pins to one hostname (Discord case)", () => {
    expect(
      isSafeWebhookUrl("https://discord.com/api/webhooks/123/abc", {
        allowOnlyHost: "discord.com",
      }),
    ).toBe(true);
    expect(
      isSafeWebhookUrl("https://discord-attacker.example/", {
        allowOnlyHost: "discord.com",
      }),
    ).toBe(false);
    expect(
      isSafeWebhookUrl("https://discord.com.attacker.example/", {
        allowOnlyHost: "discord.com",
      }),
    ).toBe(false);
  });
});