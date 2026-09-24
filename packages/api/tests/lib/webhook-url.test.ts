import { describe, expect, it } from "vitest";

import { checkWebhookHostname, isBlockedAddress } from "../../src/lib/webhooks/url";

describe("isBlockedAddress", () => {
  it("blocks loopback, private and link-local IPv4", () => {
    for (const address of [
      "127.0.0.1",
      "10.1.2.3",
      "172.16.0.1",
      "192.168.1.1",
      "169.254.169.254",
    ]) {
      expect(isBlockedAddress(address)).toBe(true);
    }
    expect(isBlockedAddress("93.184.216.34")).toBe(false);
  });

  it("judges IPv4-mapped IPv6 by IPv4 rules, in dotted and hex form", () => {
    expect(isBlockedAddress("::ffff:127.0.0.1")).toBe(true);
    expect(isBlockedAddress("::ffff:7f00:1")).toBe(true);
    expect(isBlockedAddress("::ffff:a9fe:a9fe")).toBe(true);
    expect(isBlockedAddress("::ffff:5db8:d822")).toBe(false);
  });
});

describe("checkWebhookHostname", () => {
  it("rejects an IPv4-mapped loopback literal the URL parser rewrites to hex", () => {
    expect(checkWebhookHostname("http://[::ffff:127.0.0.1]/hook").ok).toBe(false);
  });

  it("rejects internal names written with a trailing dot", () => {
    expect(checkWebhookHostname("http://localhost./hook").ok).toBe(false);
    expect(checkWebhookHostname("http://printer.local./hook").ok).toBe(false);
  });

  it("accepts a public hostname", () => {
    expect(checkWebhookHostname("https://hooks.example.com/in").ok).toBe(true);
  });
});
