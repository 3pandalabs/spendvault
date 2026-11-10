import { describe, expect, it, vi } from "vitest";
import { deliver } from "../src/index";

const env = { INTERNAL_API_URL: "https://api-internal.example/", INTERNAL_SHARED_SECRET: "s3cret" };
const msg = (size = 10) => ({
  from: "alerts@hdfcbank.net",
  to: "abc123@in.spendvault.3pandalabs.com",
  rawSize: size,
  raw: new Response("Subject: hi\r\n\r\nbody").body!,
});
const noSleep = async () => {};

describe("deliver", () => {
  it("posts the raw message with envelope + secret headers", async () => {
    const fetchImpl = vi.fn(async () => new Response("{}", { status: 200 }));
    const r = await deliver(msg(), env, fetchImpl as unknown as typeof fetch, noSleep);
    expect(r.ok).toBe(true);
    const [url, init] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("https://api-internal.example/internal/inbound-email");
    const h = init.headers as Record<string, string>;
    expect(h["x-internal-secret"]).toBe("s3cret");
    expect(h["x-envelope-to"]).toBe("abc123@in.spendvault.3pandalabs.com");
    expect(h["content-type"]).toBe("message/rfc822");
  });

  it("retries 5xx then succeeds", async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(new Response("", { status: 502 }))
      .mockResolvedValueOnce(new Response("{}", { status: 200 }));
    const r = await deliver(msg(), env, fetchImpl as unknown as typeof fetch, noSleep);
    expect(r.ok).toBe(true);
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });

  it("does not retry a 401", async () => {
    const fetchImpl = vi.fn(async () => new Response("", { status: 401 }));
    const r = await deliver(msg(), env, fetchImpl as unknown as typeof fetch, noSleep);
    expect(r).toMatchObject({ ok: false, status: 401, reason: "rejected" });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it("gives up after 3 network failures", async () => {
    const fetchImpl = vi.fn(async () => {
      throw new Error("down");
    });
    const r = await deliver(msg(), env, fetchImpl as unknown as typeof fetch, noSleep);
    expect(r).toMatchObject({ ok: false, reason: "api_unavailable" });
    expect(fetchImpl).toHaveBeenCalledTimes(3);
  });

  it("rejects oversize mail without calling the API", async () => {
    const fetchImpl = vi.fn();
    const r = await deliver(msg(30 * 1024 * 1024), env, fetchImpl as unknown as typeof fetch, noSleep);
    expect(r.reason).toBe("too_large");
    expect(fetchImpl).not.toHaveBeenCalled();
  });
});
