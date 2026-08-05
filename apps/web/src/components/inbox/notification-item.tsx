import { Link } from "@tanstack/react-router";
import { AtSign, MessageSquareReply } from "lucide-react";

import type { InboxItem } from "@nilovon-wiki/api/schemas/inbox";
import { initials, timeAgo } from "@/lib/format";
import { Avatar, AvatarFallback } from "@nilovon-wiki/ui/components/avatar";
import { cn } from "@nilovon-wiki/ui/lib/utils";

/**
 * One row of the inbox, shared by the header popover and the full list so both
 * read identically. Everything about the row is a link: a notification is only
 * useful if one click lands on the thing it is about.
 */
export function NotificationItem({
  item,
  onNavigate,
  compact = false,
}: {
  item: InboxItem;
  /** Called on click — the list marks the row read before navigating away. */
  onNavigate?: (item: InboxItem) => void;
  compact?: boolean;
}) {
  const unread = item.readAt === null;
  const Icon = item.type === "comment_reply" ? MessageSquareReply : AtSign;

  return (
    <Link
      to="/pages/$id"
      params={{ id: item.page.id }}
      hash={item.commentId ? `comment-${item.commentId}` : undefined}
      onClick={() => onNavigate?.(item)}
      aria-label={`${describe(item)} — ${timeAgo(item.createdAt)}`}
      className={cn(
        "flex gap-3 rounded-lg px-2.5 py-2 text-left transition-colors hover:bg-accent focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-hidden",
        unread && "bg-primary/[0.04]",
      )}
    >
      <div className="relative shrink-0">
        <Avatar size="sm">
          <AvatarFallback className="text-[11px] font-semibold">
            {item.actor ? initials(item.actor.name) : "?"}
          </AvatarFallback>
        </Avatar>
        <span className="absolute -right-1 -bottom-1 flex size-4 items-center justify-center rounded-full bg-background">
          <Icon className="size-3 text-muted-foreground" />
        </span>
      </div>

      <div className="min-w-0 flex-1">
        <p className={cn("text-[13px] leading-snug", compact && "line-clamp-2")}>
          {describe(item)}
        </p>
        {item.excerpt ? (
          <p className="mt-0.5 line-clamp-2 text-[12.5px] text-muted-foreground italic">
            „{item.excerpt}“
          </p>
        ) : null}
        <p className="mt-0.5 text-[11.5px] text-muted-foreground">{timeAgo(item.createdAt)}</p>
      </div>

      {unread ? (
        <span
          aria-label="Ungelesen"
          className="mt-1.5 size-2 shrink-0 self-start rounded-full bg-primary"
        />
      ) : null}
    </Link>
  );
}

/** German copy per event type. The page title is always the bold anchor. */
function describe(item: InboxItem) {
  const actor = <span className="font-semibold">{item.actor?.name ?? "Jemand"}</span>;
  const title = <span className="font-semibold">{item.page.title}</span>;
  switch (item.type) {
    case "mention_page":
      return (
        <>
          {actor} hat dich auf {title} erwähnt
        </>
      );
    case "mention_comment":
      return (
        <>
          {actor} hat dich in einem Kommentar auf {title} erwähnt
        </>
      );
    case "comment_reply":
      return (
        <>
          {actor} hat auf deinen Kommentar auf {title} geantwortet
        </>
      );
  }
}
