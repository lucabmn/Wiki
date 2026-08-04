import { useState } from "react";
import { Link } from "@tanstack/react-router";
import { Bell, CheckCheck } from "lucide-react";

import { NotificationItem } from "./notification-item";
import { useInboxList, useInboxMutations, useUnreadCount } from "./use-inbox";
import { Button } from "@nilovon-wiki/ui/components/button";
import {
  Popover,
  PopoverContent,
  PopoverTitle,
  PopoverTrigger,
} from "@nilovon-wiki/ui/components/popover";
import { Skeleton } from "@nilovon-wiki/ui/components/skeleton";

/** Rows in the popover. The full list lives behind "Alle anzeigen". */
const PREVIEW_LIMIT = 8;

/**
 * The bell in the sidebar header: an unread count that is always visible, and a
 * preview that only fetches while it is open. Opening the popover does *not*
 * mark anything read — that stays a deliberate act, so nothing can be missed by
 * glancing at it.
 */
export function NotificationBell() {
  const [open, setOpen] = useState(false);
  const unread = useUnreadCount();
  const list = useInboxList({ onlyUnread: false, limit: PREVIEW_LIMIT, enabled: open });
  const { markRead, markAllRead } = useInboxMutations();

  const count = unread.data?.count ?? 0;
  const label = count === 0 ? "Benachrichtigungen" : `Benachrichtigungen: ${count} ungelesen`;

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger
        render={
          <Button variant="outline" size="icon-sm" className="relative shrink-0" title={label}>
            <Bell className="size-4" />
            {count > 0 ? (
              <span className="absolute -top-1 -right-1 flex h-4 min-w-4 items-center justify-center rounded-full bg-primary px-1 text-[10px] leading-none font-semibold text-primary-foreground">
                {unread.data?.capped ? "99+" : count}
              </span>
            ) : null}
            <span className="sr-only">{label}</span>
          </Button>
        }
      />
      <PopoverContent align="start" className="w-80 gap-0 p-0">
        <div className="flex items-center justify-between gap-2 border-b border-border px-3 py-2">
          <PopoverTitle className="text-[13px]">Benachrichtigungen</PopoverTitle>
          <Button
            variant="ghost"
            size="sm"
            className="h-7 px-2 text-xs"
            disabled={count === 0 || markAllRead.isPending}
            onClick={() => markAllRead.mutate({})}
          >
            <CheckCheck className="size-3.5" />
            Alle gelesen
          </Button>
        </div>

        <div className="max-h-96 overflow-y-auto p-1">
          {list.isPending ? (
            <div className="space-y-2 p-2">
              <Skeleton className="h-10 w-full" />
              <Skeleton className="h-10 w-full" />
            </div>
          ) : !list.data?.length ? (
            <p className="px-3 py-8 text-center text-[13px] text-muted-foreground">
              Nichts Neues. Wenn dich jemand erwähnt, steht es hier.
            </p>
          ) : (
            <div className="flex flex-col">
              {list.data.map((item) => (
                <NotificationItem
                  key={item.id}
                  item={item}
                  compact
                  onNavigate={() => {
                    setOpen(false);
                    if (!item.readAt) markRead.mutate({ id: item.id, read: true });
                  }}
                />
              ))}
            </div>
          )}
        </div>

        <div className="border-t border-border p-1">
          <Button
            variant="ghost"
            size="sm"
            className="w-full justify-center text-xs"
            render={
              <Link to="/inbox" search={{ filter: "all" }} onClick={() => setOpen(false)}>
                Alle anzeigen
              </Link>
            }
          />
        </div>
      </PopoverContent>
    </Popover>
  );
}
