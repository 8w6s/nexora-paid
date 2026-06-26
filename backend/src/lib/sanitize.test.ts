import { describe, expect, test } from "bun:test";
import { sanitizeHtml, sanitizeHtmlOptional } from "./sanitize.ts";

describe("sanitizeHtml", () => {
  test("keeps allowed tags + text content", () => {
    const out = sanitizeHtml("<p>Hello <strong>world</strong></p>");
    expect(out).toBe("<p>Hello <strong>world</strong></p>");
  });

  test("strips script tag + contents", () => {
    const out = sanitizeHtml("<p>ok</p><script>alert(1)</script>");
    expect(out).not.toContain("alert");
    expect(out).not.toContain("script");
    expect(out).toContain("<p>ok</p>");
  });

  test("strips onerror and other event handlers", () => {
    const out = sanitizeHtml('<img src="x" onerror="alert(1)">');
    expect(out).not.toContain("onerror");
    expect(out).not.toContain("alert");
  });

  test("rejects javascript: href", () => {
    const out = sanitizeHtml('<a href="javascript:alert(1)">x</a>');
    expect(out).not.toContain("javascript");
    expect(out).not.toContain("alert");
  });

  test("keeps https href + ads rel for target=_blank", () => {
    const out = sanitizeHtml('<a href="https://example.com" target="_blank">ok</a>');
    expect(out).toContain('href="https://example.com"');
    expect(out).toContain('target="_blank"');
    expect(out).toContain("noopener");
  });

  test("strips svg + onload", () => {
    const out = sanitizeHtml("<svg onload=alert(1)></svg>");
    expect(out).not.toContain("svg");
    expect(out).not.toContain("alert");
  });

  test("strips iframe", () => {
    const out = sanitizeHtml('<iframe src="//evil"></iframe>');
    expect(out).not.toContain("iframe");
    expect(out).not.toContain("evil");
  });

  test("keeps img with safe src", () => {
    const out = sanitizeHtml('<img src="https://ex.com/a.png" alt="x">');
    expect(out).toContain('src="https://ex.com/a.png"');
    expect(out).toContain('alt="x"');
  });

  test("keeps data:image src", () => {
    const out = sanitizeHtml('<img src="data:image/png;base64,iVBOR">');
    expect(out).toContain("data:image/png");
  });

  test("strips data:text/html src", () => {
    const out = sanitizeHtml('<img src="data:text/html,<script>alert(1)">');
    expect(out).not.toContain("data:text/html");
  });

  test("plain text passes through", () => {
    expect(sanitizeHtml("hello world")).toBe("hello world");
  });

  test("empty + non-string returns empty", () => {
    expect(sanitizeHtml("")).toBe("");
    expect(sanitizeHtml(null)).toBe("");
    expect(sanitizeHtml(undefined)).toBe("");
    expect(sanitizeHtml(123)).toBe("");
  });

  test("strips html comments", () => {
    const out = sanitizeHtml("<p>ok</p><!-- secret -->");
    expect(out).not.toContain("secret");
  });

  test("strips disallowed tag but keeps inner text", () => {
    const out = sanitizeHtml("<custom>hello</custom>");
    expect(out).toContain("hello");
    expect(out).not.toContain("custom");
  });

  test("nested + mixed payload", () => {
    const out = sanitizeHtml(
      '<p>Buy <a href="https://shop.test">here</a><script>steal()</script><img src="x" onerror="bad"></p>',
    );
    expect(out).toContain("Buy");
    expect(out).toContain("here");
    expect(out).toContain('href="https://shop.test"');
    expect(out).not.toContain("script");
    expect(out).not.toContain("steal");
    expect(out).not.toContain("oneror");
  });
});

describe("sanitizeHtmlOptional", () => {
  test("returns sanitized string when input is string", () => {
    expect(sanitizeHtmlOptional("<p>ok<script>x</script></p>")).toBe("<p>ok</p>");
  });

  test("passes through undefined/null", () => {
    expect(sanitizeHtmlOptional(undefined)).toBe(undefined);
    expect(sanitizeHtmlOptional(null)).toBe(null);
  });
});