import { describe, expect, it, vi } from "vitest";
import { newUserAlertTo, newUserMail, notifyNewUser } from "../../src/lib/newUserAlert.js";

const flush = () => new Promise((r) => setTimeout(r, 0));
const u = { email: "a@example.com", userId: "u" };

describe("new user alert", () => {
  it("subject is exactly 'SpendVault New user' and the body names the account", () => {
    const m = newUserMail("ops@example.com", {
      email: "owner@example.com",
      userId: "u1",
      displayName: 'Joe <b>"Bloggs"</b>',
      at: new Date("2026-11-26T13:05:00Z"),
    });
    expect(m.subject).toBe("SpendVault New user");
    expect(m.to).toBe("ops@example.com");
    expect(m.text).toContain("App: SpendVault");
    expect(m.text).toContain("Email: owner@example.com");
    expect(m.text).toContain("Signed up: 2026-11-26 13:05 UTC");
    expect(m.text).toContain("User id: u1");
    expect(m.html).toContain("Joe &lt;b&gt;&quot;Bloggs&quot;&lt;/b&gt;");
    expect(m.html).not.toContain('<b>"Bloggs"');
  });

  it("omits the name row when there is none", () => {
    expect(newUserMail("ops@example.com", u).text).not.toContain("Name:");
  });

  it("goes to the org inbox by default, an override, or nowhere when off", () => {
    expect(newUserAlertTo(undefined)).toBe("3pandas@3pandalabs.com");
    expect(newUserAlertTo("  ")).toBe("3pandas@3pandalabs.com");
    expect(newUserAlertTo("x@example.com")).toBe("x@example.com");
    expect(newUserAlertTo("OFF")).toBeNull();
  });

  it("sends one message when configured", async () => {
    const send = vi.fn().mockResolvedValue({ delivered: 1, failed: 0, skipped: 0 });
    notifyNewUser(u, { send, configured: () => true, log: () => {}, to: "ops@example.com" });
    await flush();
    expect(send).toHaveBeenCalledTimes(1);
    expect(send.mock.calls[0][0][0].subject).toBe("SpendVault New user");
  });

  it("does nothing when off or the mailer is not configured", async () => {
    const send = vi.fn();
    notifyNewUser(u, { send, configured: () => true, log: () => {}, to: null });
    notifyNewUser(u, { send, configured: () => false, log: () => {}, to: "ops@example.com" });
    await flush();
    expect(send).not.toHaveBeenCalled();
  });

  it("never throws into the sign-up: sync throw, rejection and failed sends only log", async () => {
    const log = vi.fn();
    const to = "ops@example.com";
    expect(() =>
      notifyNewUser(u, {
        send: () => {
          throw new Error("boom");
        },
        configured: () => true,
        log,
        to,
      }),
    ).not.toThrow();
    expect(() => notifyNewUser(u, { send: () => Promise.reject(new Error("down")), configured: () => true, log, to })).not.toThrow();
    notifyNewUser(u, { send: async () => ({ delivered: 0, failed: 1, skipped: 0 }), configured: () => true, log, to });
    await flush();
    expect(log).toHaveBeenCalledWith(expect.stringContaining("boom"));
    expect(log).toHaveBeenCalledWith(expect.stringContaining("down"));
    expect(log).toHaveBeenCalledWith(expect.stringContaining("failed=1"));
  });
});
