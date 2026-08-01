import { describe, expect, it } from "vitest";

import {
  MAX_EXTERNAL_URL_LENGTH,
  externalUrlHost,
  normalizeExternalUrl,
} from "../../src/lib/external-url";

describe("normalizeExternalUrl", () => {
  it("keeps a plain https URL", () => {
    expect(normalizeExternalUrl("https://example.com/docs")).toBe("https://example.com/docs");
  });

  it("accepts http and trims surrounding whitespace", () => {
    expect(normalizeExternalUrl("  http://example.com  ")).toBe("http://example.com/");
  });

  it("assumes https for a hand-typed host", () => {
    expect(normalizeExternalUrl("example.com/docs")).toBe("https://example.com/docs");
  });

  it("preserves query and fragment — two deep links to one page differ by them", () => {
    expect(normalizeExternalUrl("https://example.com/a?b=1#c")).toBe("https://example.com/a?b=1#c");
  });

  // The security contract: only http(s) may ever reach an href.
  it.each([
    ["javascript:alert(1)"],
    ["JavaScript:alert(1)"],
    ["  javascript:alert(1)"],
    ["data:text/html;base64,PHNjcmlwdD4="],
    ["vbscript:msgbox(1)"],
    ["file:///etc/passwd"],
    ["ftp://example.com/file"],
    ["mailto:someone@example.com"],
  ])("rejects %s", (input) => {
    expect(normalizeExternalUrl(input)).toBeNull();
  });

  it("rejects a protocol-relative URL rather than inheriting the app's scheme", () => {
    expect(normalizeExternalUrl("//evil.example")).toBeNull();
  });

  it("strips embedded credentials so they never land in a rendered anchor", () => {
    expect(normalizeExternalUrl("https://user:secret@example.com/x")).toBe("https://example.com/x");
  });

  it.each([[""], ["   "], ["https://"], ["not a url"]])(
    "rejects the unusable input %j",
    (input) => {
      expect(normalizeExternalUrl(input)).toBeNull();
    },
  );

  it("rejects anything past the length cap", () => {
    const long = `https://example.com/${"a".repeat(MAX_EXTERNAL_URL_LENGTH)}`;
    expect(normalizeExternalUrl(long)).toBeNull();
  });
});

describe("externalUrlHost", () => {
  it("returns the host without a www prefix", () => {
    expect(externalUrlHost("https://www.example.com/docs")).toBe("example.com");
    expect(externalUrlHost("https://docs.example.com/x")).toBe("docs.example.com");
  });

  it("falls back to the input instead of throwing", () => {
    expect(externalUrlHost("nonsense")).toBe("nonsense");
  });
});
