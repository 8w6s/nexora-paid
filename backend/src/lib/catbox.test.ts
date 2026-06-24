/**
 * catbox.ts — transport-layer unit tests.
 *
 * We don't hit the real catbox.moe in tests. The `endpoint` option lets us
 * point at a mock URL whose response we drive via a request interceptor.
 */
import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { CATBOX_MAX_BYTES, isCatboxUrl, uploadBufferToCatbox } from "./catbox.ts";

type FetchFn = typeof globalThis.fetch;
const realFetch: FetchFn = globalThis.fetch;

function mockFetch(handler: (req: Request) => Response | Promise<Response>): void {
  globalThis.fetch = ((input: RequestInfo | URL, init?: RequestInit) => {
    const req = input instanceof Request ? input : new Request(String(input), init);
    return Promise.resolve(handler(req));
  }) as FetchFn;
}

describe("catbox.uploadBufferToCatbox", () => {
  beforeEach(() => {
    delete (Bun.env as Record<string, string | undefined>).CATBOX_USERHASH;
  });
  afterEach(() => {
    globalThis.fetch = realFetch;
  });

  it("returns the catbox URL on success", async () => {
    mockFetch(() => new Response("https://files.catbox.moe/ab12cd.png", { status: 200 }));
    const r = await uploadBufferToCatbox("avatar.png", new Uint8Array([1, 2, 3, 4]), {
      endpoint: "http://mock/catbox",
    });
    expect(r.url).toBe("https://files.catbox.moe/ab12cd.png");
    expect(r.bytes).toBe(4);
    expect(r.filename).toBe("avatar.png");
  });

  it("strips directory components from filename", async () => {
    let captured: FormData | null = null;
    mockFetch(async (req) => {
      captured = await req.formData();
      return new Response("https://files.catbox.moe/zz99.bin", { status: 200 });
    });
    const r = await uploadBufferToCatbox("../../etc/passwd", new Uint8Array([1]), {
      endpoint: "http://mock/catbox",
    });
    expect(r.filename).toBe("passwd");
    expect(captured).not.toBeNull();
  });

  it("refuses empty buffer", async () => {
    mockFetch(() => new Response("nope", { status: 200 }));
    await expect(
      uploadBufferToCatbox("x.txt", new Uint8Array(0), { endpoint: "http://mock/catbox" }),
    ).rejects.toThrow(/empty/);
  });

  it("refuses oversize buffer without contacting catbox", async () => {
    let called = false;
    mockFetch(() => {
      called = true;
      return new Response("", { status: 200 });
    });
    const huge = new Uint8Array(CATBOX_MAX_BYTES + 1);
    await expect(
      uploadBufferToCatbox("big.bin", huge, { endpoint: "http://mock/catbox" }),
    ).rejects.toThrow(/too large/);
    expect(called).toBe(false);
  });

  it("throws on non-URL response body", async () => {
    mockFetch(() => new Response("<html>error: spam detected</html>", { status: 200 }));
    await expect(
      uploadBufferToCatbox("a.bin", new Uint8Array([1]), { endpoint: "http://mock/catbox" }),
    ).rejects.toThrow(/unexpected response/);
  });

  it("throws on HTTP error status with body excerpt", async () => {
    mockFetch(() => new Response("rate limited, try later", { status: 429 }));
    await expect(
      uploadBufferToCatbox("a.bin", new Uint8Array([1]), { endpoint: "http://mock/catbox" }),
    ).rejects.toThrow(/HTTP 429/);
  });

  it("forwards CATBOX_USERHASH env when set", async () => {
    Bun.env.CATBOX_USERHASH = "abc123userhash";
    let userhashSeen: string | null = null;
    mockFetch(async (req) => {
      const fd = await req.formData();
      userhashSeen = String(fd.get("userhash") ?? "");
      return new Response("https://files.catbox.moe/aa11.bin", { status: 200 });
    });
    await uploadBufferToCatbox("a.bin", new Uint8Array([1]), { endpoint: "http://mock/catbox" });
    expect(userhashSeen).toBe("abc123userhash");
  });

  it("omits userhash field when no env / opt", async () => {
    let userhashKey = true;
    mockFetch(async (req) => {
      const fd = await req.formData();
      userhashKey = fd.has("userhash");
      return new Response("https://files.catbox.moe/bb22.bin", { status: 200 });
    });
    await uploadBufferToCatbox("a.bin", new Uint8Array([1]), { endpoint: "http://mock/catbox" });
    expect(userhashKey).toBe(false);
  });
});

describe("catbox.isCatboxUrl", () => {
  it("accepts canonical catbox URLs", () => {
    expect(isCatboxUrl("https://files.catbox.moe/ab12cd.png")).toBe(true);
    expect(isCatboxUrl("https://files.catbox.moe/abcdef.mp4")).toBe(true);
    expect(isCatboxUrl("https://files.catbox.moe/aa11")).toBe(true);
  });
  it("rejects non-catbox URLs", () => {
    expect(isCatboxUrl("http://files.catbox.moe/ab12cd.png")).toBe(false);
    expect(isCatboxUrl("https://evil.example/abc.png")).toBe(false);
    expect(isCatboxUrl("not a url")).toBe(false);
    expect(isCatboxUrl("")).toBe(false);
  });
});