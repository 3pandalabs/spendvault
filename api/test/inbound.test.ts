import { describe, expect, it } from "vitest";
import { forwardingAddressFor, tokenFromLocalPart } from "../src/lib/inbound.js";

describe("forwarding addresses", () => {
  it("builds a plus address", () => {
    expect(forwardingAddressFor("k7m2p9xq4abc", "vault", "in.spendvault.3pandalabs.com")).toBe("vault+k7m2p9xq4abc@in.spendvault.3pandalabs.com");
  });
  it("extracts the tag", () => {
    expect(tokenFromLocalPart("vault+K7M2p9xq4abc")).toBe("k7m2p9xq4abc");
    expect(tokenFromLocalPart("vault+a+b")).toBe("b");
  });
  it("accepts a bare token (old-style address)", () => {
    expect(tokenFromLocalPart("k7m2p9xq4abc")).toBe("k7m2p9xq4abc");
  });
  it("rejects empty", () => {
    expect(tokenFromLocalPart("vault+")).toBeNull();
    expect(tokenFromLocalPart("")).toBeNull();
  });
});
