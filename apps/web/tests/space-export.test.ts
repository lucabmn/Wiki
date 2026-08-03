import { describe, expect, it } from "vitest";

import { spaceExportUrl } from "@/lib/space-export";

describe("Space export URL", () => {
  it.each(["markdown", "html", "json"] as const)("builds the %s download URL", (format) => {
    expect(spaceExportUrl("https://api.example.test/", "space/id", format)).toBe(
      `https://api.example.test/exports/spaces/space%2Fid?format=${format}`,
    );
  });
});
