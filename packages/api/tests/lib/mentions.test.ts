import { describe, expect, it } from "vitest";

import {
  mentionedUserIdsInDocument,
  mentionedUserIdsInText,
} from "../../src/lib/notifications/mentions";

const paragraph = (...nodes: unknown[]) => ({
  type: "doc",
  content: [{ type: "paragraph", content: nodes }],
});
const mention = (id: string) => ({ type: "mention", attrs: { id, label: id } });

describe("mentionedUserIdsInDocument", () => {
  it("collects mention nodes from anywhere in the tree", () => {
    const doc = {
      type: "doc",
      content: [
        { type: "paragraph", content: [mention("u1")] },
        {
          type: "bulletList",
          content: [
            { type: "listItem", content: [{ type: "paragraph", content: [mention("u2")] }] },
          ],
        },
      ],
    };
    expect(mentionedUserIdsInDocument(doc).sort()).toEqual(["u1", "u2"]);
  });

  it("de-duplicates repeated mentions of the same person", () => {
    expect(mentionedUserIdsInDocument(paragraph(mention("u1"), mention("u1")))).toEqual(["u1"]);
  });

  it("yields nothing for malformed input instead of throwing", () => {
    for (const input of [null, undefined, "text", 42, {}, { content: "not-an-array" }]) {
      expect(mentionedUserIdsInDocument(input)).toEqual([]);
    }
  });

  it("ignores a mention node without a usable id", () => {
    expect(mentionedUserIdsInDocument(paragraph({ type: "mention", attrs: { id: 7 } }))).toEqual(
      [],
    );
  });

  it("stops at the depth cap rather than overflowing the stack", () => {
    let node: Record<string, unknown> = mention("deep");
    for (let i = 0; i < 5000; i++) node = { type: "paragraph", content: [node] };
    expect(() => mentionedUserIdsInDocument(node)).not.toThrow();
    expect(mentionedUserIdsInDocument(node)).toEqual([]);
  });
});

const PEOPLE = [
  { id: "ada", name: "Ada Lovelace" },
  { id: "adam", name: "Ada" },
  { id: "grace", name: "Grace Hopper" },
];

describe("mentionedUserIdsInText", () => {
  it("resolves a name against the candidates", () => {
    expect(mentionedUserIdsInText("Frage an @Grace Hopper", PEOPLE)).toEqual(["grace"]);
  });

  it("prefers the longest matching name", () => {
    expect(mentionedUserIdsInText("@Ada Lovelace bitte prüfen", PEOPLE)).toEqual(["ada"]);
    expect(mentionedUserIdsInText("@Ada bitte prüfen", PEOPLE)).toEqual(["adam"]);
  });

  it("matches regardless of case and stops at punctuation", () => {
    expect(mentionedUserIdsInText("hallo @grace hopper!", PEOPLE)).toEqual(["grace"]);
  });

  it("ignores an e-mail address and an unknown name", () => {
    expect(mentionedUserIdsInText("mail an ada@lovelace.io oder @Niemand", PEOPLE)).toEqual([]);
  });

  it("de-duplicates and returns nothing without an @", () => {
    expect(mentionedUserIdsInText("@Ada und nochmal @Ada", PEOPLE)).toEqual(["adam"]);
    expect(mentionedUserIdsInText("kein Name hier", PEOPLE)).toEqual([]);
  });
});
