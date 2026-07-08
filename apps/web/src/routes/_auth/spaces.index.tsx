import DashboardLayout from "@/components/layouts/dashboard-layout";
import { orpc } from "@/utils/orpc";
import { Badge } from "@nilovon-wiki/ui/components/badge";
import { Card } from "@nilovon-wiki/ui/components/card";
import { Skeleton } from "@nilovon-wiki/ui/components/skeleton";
import { useQuery } from "@tanstack/react-query";
import { Link, createFileRoute } from "@tanstack/react-router";
import { Folder } from "lucide-react";

export const Route = createFileRoute("/_auth/spaces/")({
  component: RouteComponent,
});

const VISIBILITY_LABEL: Record<string, string> = {
  public: "Öffentlich",
  private: "Privat",
  restricted: "Eingeschränkt",
};

function RouteComponent() {
  const { data: spaces, isPending } = useQuery(orpc.spaces.list.queryOptions({ input: {} }));

  return (
    <DashboardLayout className="p-7">
      <div>
        <h1 className="text-lg font-semibold">Alle Spaces</h1>
        <p className="text-sm text-muted-foreground">Die Spaces, auf die du Zugriff hast.</p>
      </div>

      {isPending ? (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {[0, 1, 2].map((i) => (
            <Skeleton key={i} className="h-24" />
          ))}
        </div>
      ) : !spaces?.length ? (
        <p className="text-sm text-muted-foreground">Noch keine Spaces.</p>
      ) : (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {spaces.map((space) => (
            <Link key={space.id} to="/spaces/$slug" params={{ slug: space.slug }} className="block">
              <Card className="h-full gap-2 p-4 transition-colors hover:border-primary/40">
                <div className="flex items-center gap-2.5">
                  <span
                    className="flex size-9 shrink-0 items-center justify-center rounded-lg text-white shadow-sm"
                    style={{ backgroundColor: space.color ?? "#1E6DE1" }}
                  >
                    {space.icon ? (
                      <span className="text-base leading-none">{space.icon}</span>
                    ) : (
                      <Folder className="size-4.5" />
                    )}
                  </span>
                  <span className="truncate font-medium">{space.name}</span>
                  <Badge variant="outline" className="ml-auto shrink-0">
                    {VISIBILITY_LABEL[space.visibility] ?? space.visibility}
                  </Badge>
                </div>
                {space.description ? (
                  <p className="line-clamp-2 text-sm text-muted-foreground">{space.description}</p>
                ) : null}
              </Card>
            </Link>
          ))}
        </div>
      )}
    </DashboardLayout>
  );
}
