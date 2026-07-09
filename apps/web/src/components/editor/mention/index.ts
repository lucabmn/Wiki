import { client } from "@/utils/orpc";
import { ReactRenderer } from "@tiptap/react";
import type { MentionOptions } from "@tiptap/extension-mention";

import { MentionList, type MentionItem, type MentionListRef } from "./mention-list";

type MentionListProps = { items: MentionItem[]; command: (item: MentionItem) => void };

/**
 * Space members eligible to be mentioned, cached per space for the session so
 * typing `@a…b…c` doesn't refetch on every keystroke. Only user (not team/role)
 * grants are mentionable.
 */
const membersBySpace = new Map<string, Promise<MentionItem[]>>();

function loadMembers(spaceId: string): Promise<MentionItem[]> {
  let cached = membersBySpace.get(spaceId);
  if (!cached) {
    cached = client.spaceMembers
      .list({ spaceId })
      .then((rows) =>
        rows
          .filter((row) => row.subject === "user" && row.user)
          .map((row) => ({ id: row.user!.id, label: row.user!.name })),
      )
      .catch((error) => {
        // Don't poison the cache on a transient failure — retry next trigger.
        membersBySpace.delete(spaceId);
        throw error;
      });
    membersBySpace.set(spaceId, cached);
  }
  return cached;
}

/** Position the popup just under the caret (fixed, like the slash menu). */
function place(el: HTMLElement, clientRect?: (() => DOMRect | null) | null) {
  const rect = clientRect?.();
  if (!rect) return;
  el.style.left = `${rect.left}px`;
  el.style.top = `${rect.bottom + 6}px`;
}

/**
 * `@mention` suggestion config for the collaborative editor. Passed into the
 * shared `Mention` node (which supplies the default insert `command`); this only
 * provides the item lookup and the popup renderer. Scoped to the page's space so
 * you can only mention people who can see the space.
 */
export function createMentionSuggestion(spaceId: string): Partial<MentionOptions["suggestion"]> {
  return {
    items: async ({ query }) => {
      const members = await loadMembers(spaceId);
      const q = query.toLowerCase().trim();
      const matches = q
        ? members.filter((member) => member.label.toLowerCase().includes(q))
        : members;
      return matches.slice(0, 8);
    },

    render: () => {
      let component: ReactRenderer<MentionListRef, MentionListProps> | null = null;
      let el: HTMLElement | null = null;

      return {
        onStart: (props) => {
          component = new ReactRenderer(MentionList, {
            props: { items: props.items, command: props.command },
            editor: props.editor,
          });
          el = document.createElement("div");
          el.style.position = "fixed";
          el.style.zIndex = "50";
          el.appendChild(component.element);
          document.body.appendChild(el);
          place(el, props.clientRect);
        },
        onUpdate: (props) => {
          component?.updateProps({ items: props.items, command: props.command });
          if (el) place(el, props.clientRect);
        },
        onKeyDown: (props) => {
          if (props.event.key === "Escape") {
            el?.remove();
            return true;
          }
          return component?.ref?.onKeyDown({ event: props.event }) ?? false;
        },
        onExit: () => {
          el?.remove();
          el = null;
          component?.destroy();
          component = null;
        },
      };
    },
  };
}
