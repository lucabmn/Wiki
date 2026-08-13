import DashboardLayout from "@/components/layouts/dashboard-layout";
import { CourseCard } from "@/components/learn/course-card";
import { CreateCourseDialog } from "@/components/learn/create-course-dialog";
import { QueryError } from "@/components/query-error";
import { usePermission } from "@/lib/permissions";
import { orpc } from "@/utils/orpc";
import { Badge } from "@nilovon-wiki/ui/components/badge";
import { Button } from "@nilovon-wiki/ui/components/button";
import {
  Empty,
  EmptyContent,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@nilovon-wiki/ui/components/empty";
import { Input } from "@nilovon-wiki/ui/components/input";
import { Skeleton } from "@nilovon-wiki/ui/components/skeleton";
import { Tabs, TabsList, TabsTrigger } from "@nilovon-wiki/ui/components/tabs";
import { cn } from "@nilovon-wiki/ui/lib/utils";
import { useQuery } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import { GraduationCap, Plus, Search, X } from "lucide-react";
import { useMemo, useState } from "react";

export const Route = createFileRoute("/_auth/learn/")({
  component: RouteComponent,
});

/**
 * Which slice of the catalog is on screen. These are three genuinely different
 * questions — "what can I take", "what am I taking", "what do I teach" — and
 * conflating them into one list with a filter chip buries the second, which is
 * the one a learner opens the page for.
 */
type Scope = "catalog" | "learning" | "teaching";

const SCOPES: { value: Scope; label: string }[] = [
  { value: "catalog", label: "Katalog" },
  { value: "learning", label: "Meine Kurse" },
  { value: "teaching", label: "Meine Lehre" },
];

function RouteComponent() {
  const [scope, setScope] = useState<Scope>("catalog");
  const [query, setQuery] = useState("");
  const [topicId, setTopicId] = useState<string | null>(null);
  const [createOpen, setCreateOpen] = useState(false);
  const canCreate = usePermission({ course: ["create"] });

  const courses = useQuery(
    orpc.learn.courses.list.queryOptions({
      input: {
        enrolledOnly: scope === "learning",
        authoredOnly: scope === "teaching",
        includeArchived: scope !== "catalog",
        topicId: topicId ?? undefined,
      },
    }),
  );
  const topics = useQuery(orpc.learn.courseTopics.list.queryOptions({ input: {} }));

  // Filtering by title happens in the browser: the list is already scoped to
  // what the caller may see, and a keystroke-per-request round trip would be
  // slower than filtering the page that is already in hand.
  const visible = useMemo(() => {
    const needle = query.trim().toLowerCase();
    if (!needle) return courses.data ?? [];
    return (courses.data ?? []).filter(
      (course) =>
        course.title.toLowerCase().includes(needle) ||
        (course.tagline ?? "").toLowerCase().includes(needle),
    );
  }, [courses.data, query]);

  return (
    <DashboardLayout>
      <div className="mx-auto w-full max-w-6xl space-y-6 p-4 md:p-6">
        <header className="flex flex-wrap items-start justify-between gap-4">
          <div className="space-y-1">
            <h1 className="text-2xl font-semibold tracking-tight">Lernen</h1>
            <p className="text-muted-foreground text-sm">
              Kurse deiner Organisation — belegen, fortsetzen und unterrichten.
            </p>
          </div>
          {canCreate && (
            <Button onClick={() => setCreateOpen(true)}>
              <Plus className="size-4" aria-hidden />
              Kurs erstellen
            </Button>
          )}
        </header>

        <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
          <Tabs value={scope} onValueChange={(value) => setScope(value as Scope)}>
            <TabsList>
              {SCOPES.map((item) => (
                <TabsTrigger key={item.value} value={item.value}>
                  {item.label}
                </TabsTrigger>
              ))}
            </TabsList>
          </Tabs>

          <div className="relative w-full md:max-w-xs">
            <Search
              className="text-muted-foreground pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2"
              aria-hidden
            />
            <Input
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Kurse durchsuchen"
              aria-label="Kurse durchsuchen"
              className="pl-9"
            />
            {query && (
              <Button
                type="button"
                variant="ghost"
                size="icon"
                className="absolute top-1/2 right-1 size-7 -translate-y-1/2"
                onClick={() => setQuery("")}
                aria-label="Suche zurücksetzen"
              >
                <X className="size-4" aria-hidden />
              </Button>
            )}
          </div>
        </div>

        {(topics.data?.length ?? 0) > 0 && (
          <div className="flex flex-wrap gap-1.5">
            <TopicChip active={topicId === null} onClick={() => setTopicId(null)}>
              Alle Themen
            </TopicChip>
            {topics.data?.map((topic) => (
              <TopicChip
                key={topic.id}
                active={topicId === topic.id}
                onClick={() => setTopicId(topicId === topic.id ? null : topic.id)}
                color={topic.color}
              >
                {topic.name}
                <span className="text-muted-foreground ml-1 tabular-nums">{topic.courseCount}</span>
              </TopicChip>
            ))}
          </div>
        )}

        {courses.isError ? (
          <QueryError error={courses.error} onRetry={() => void courses.refetch()} />
        ) : courses.isPending ? (
          <CourseGridSkeleton />
        ) : visible.length === 0 ? (
          <EmptyCatalog scope={scope} filtered={query.length > 0 || topicId !== null} />
        ) : (
          <ul className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {visible.map((course) => (
              <li key={course.id}>
                <CourseCard course={course} />
              </li>
            ))}
          </ul>
        )}
      </div>

      <CreateCourseDialog open={createOpen} onOpenChange={setCreateOpen} />
    </DashboardLayout>
  );
}

function TopicChip({
  active,
  color,
  onClick,
  children,
}: {
  active: boolean;
  color?: string | null;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button type="button" onClick={onClick} aria-pressed={active}>
      <Badge
        variant={active ? "default" : "outline"}
        className={cn("cursor-pointer", !active && "hover:bg-accent")}
        style={!active && color ? { borderColor: color } : undefined}
      >
        {children}
      </Badge>
    </button>
  );
}

function CourseGridSkeleton() {
  return (
    <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
      {Array.from({ length: 6 }).map((_, index) => (
        <div key={index} className="space-y-3">
          <Skeleton className="aspect-video w-full rounded-xl" />
          <Skeleton className="h-4 w-3/4" />
          <Skeleton className="h-3 w-1/2" />
        </div>
      ))}
    </div>
  );
}

function EmptyCatalog({ scope, filtered }: { scope: Scope; filtered: boolean }) {
  const copy = filtered
    ? {
        title: "Nichts gefunden",
        description: "Passe die Suche oder das Thema an.",
      }
    : scope === "learning"
      ? {
          title: "Du belegst noch keinen Kurs",
          description: "Im Katalog findest du alles, was für dich freigegeben ist.",
        }
      : scope === "teaching"
        ? {
            title: "Du unterrichtest noch keinen Kurs",
            description: "Sobald dich jemand ins Kursteam aufnimmt, erscheint der Kurs hier.",
          }
        : {
            title: "Noch keine Kurse",
            description: "Erstelle den ersten Kurs deiner Organisation.",
          };

  return (
    <Empty>
      <EmptyHeader>
        <EmptyMedia variant="icon">
          <GraduationCap />
        </EmptyMedia>
        <EmptyTitle>{copy.title}</EmptyTitle>
        <EmptyDescription>{copy.description}</EmptyDescription>
      </EmptyHeader>
      <EmptyContent />
    </Empty>
  );
}
