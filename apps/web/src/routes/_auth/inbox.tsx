import { createFileRoute } from "@tanstack/react-router";
import { BellOff, CheckCheck } from "lucide-react";

import DashboardLayout from "@/components/layouts/dashboard-layout";
import { NotificationItem } from "@/components/inbox/notification-item";
import { useInboxList, useInboxMutations, useUnreadCount } from "@/components/inbox/use-inbox";
import { Button } from "@nilovon-wiki/ui/components/button";
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@nilovon-wiki/ui/components/empty";
import { Skeleton } from "@nilovon-wiki/ui/components/skeleton";
import { Tabs, TabsList, TabsTrigger } from "@nilovon-wiki/ui/components/tabs";

const PAGE_LIMIT = 50;

type InboxSearch = { filter: "unread" | "all" };

export const Route = createFileRoute("/_auth/inbox")({
  // The filter lives in the URL so a link to the unread list stays one.
  validateSearch: (search: Record<string, unknown>): InboxSearch => ({
    filter: search.filter === "all" ? "all" : "unread",
  }),
  component: InboxRoute,
});

/** The full inbox: everything the bell previews, with a read/unread filter. */
function InboxRoute() {
  const { filter } = Route.useSearch();
  const navigate = Route.useNavigate();
  const unread = useUnreadCount();
  const list = useInboxList({ onlyUnread: filter === "unread", limit: PAGE_LIMIT });
  const { markRead, markAllRead } = useInboxMutations();
  const unreadCount = unread.data?.count ?? 0;

  return (
    <DashboardLayout className="gap-0 p-7">
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-lg font-semibold">Posteingang</h1>
          <p className="text-sm text-muted-foreground">
            Wenn dich jemand erwähnt oder auf deinen Kommentar antwortet, findest du es hier.
          </p>
        </div>
        <Button
          variant="outline"
          size="sm"
          disabled={unreadCount === 0 || markAllRead.isPending}
          onClick={() => markAllRead.mutate({})}
        >
          <CheckCheck className="size-4" />
          Alle als gelesen markieren
        </Button>
      </header>

      <Tabs
        value={filter}
        onValueChange={(value) =>
          navigate({ search: { filter: value === "all" ? "all" : "unread" }, replace: true })
        }
        className="mt-6"
      >
        <TabsList>
          <TabsTrigger value="unread">
            Ungelesen
            {unreadCount > 0 ? (
              <span className="ml-1.5 rounded-full bg-primary/10 px-1.5 text-[11px] font-semibold text-primary">
                {unread.data?.capped ? "99+" : unreadCount}
              </span>
            ) : null}
          </TabsTrigger>
          <TabsTrigger value="all">Alle</TabsTrigger>
        </TabsList>
      </Tabs>

      <div className="mt-4 max-w-2xl">
        {list.isPending ? (
          <div className="space-y-2">
            <Skeleton className="h-14 w-full rounded-lg" />
            <Skeleton className="h-14 w-full rounded-lg" />
            <Skeleton className="h-14 w-full rounded-lg" />
          </div>
        ) : !list.data?.length ? (
          <Empty>
            <EmptyHeader>
              <EmptyMedia variant="icon">
                <BellOff />
              </EmptyMedia>
              <EmptyTitle>
                {filter === "unread" ? "Alles gelesen" : "Noch keine Benachrichtigungen"}
              </EmptyTitle>
              <EmptyDescription>
                {filter === "unread"
                  ? "Hier ist gerade nichts offen."
                  : "Erwähnungen und Antworten auf deine Kommentare sammeln sich hier."}
              </EmptyDescription>
            </EmptyHeader>
          </Empty>
        ) : (
          <div className="flex flex-col divide-y divide-border">
            {list.data.map((item) => (
              <NotificationItem
                key={item.id}
                item={item}
                onNavigate={() => {
                  if (!item.readAt) markRead.mutate({ id: item.id, read: true });
                }}
              />
            ))}
          </div>
        )}
      </div>
    </DashboardLayout>
  );
}
