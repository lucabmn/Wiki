import { Fragment } from "react";
import { useQuery } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";

import { orpc } from "@/utils/orpc";
import {
  Breadcrumb,
  BreadcrumbEllipsis,
  BreadcrumbItem,
  BreadcrumbLink,
  BreadcrumbList,
  BreadcrumbPage,
  BreadcrumbSeparator,
} from "@nilovon-wiki/ui/components/breadcrumb";

/**
 * Space › Ancestors › Title trail for nested pages. Resolves ancestors from
 * the space's flat tree — the same query key the sidebar uses — so the chain
 * comes from cache instead of one request per level, and carries titles rather
 * than whole page bodies.
 */
export function PageBreadcrumb({
  page,
  space,
}: {
  page: { id: string; title: string; parentId: string | null; spaceId: string };
  space?: { slug: string; name: string };
}) {
  const { data: allPages } = useQuery(
    orpc.pages.tree.queryOptions({ input: { spaceId: page.spaceId } }),
  );

  const byId = new Map((allPages ?? []).map((p) => [p.id, p]));
  const ancestors: { id: string; title: string }[] = [];
  const seen = new Set<string>([page.id]);
  let cursor = page.parentId;
  while (cursor && !seen.has(cursor)) {
    const node = byId.get(cursor);
    if (!node) break;
    seen.add(node.id);
    ancestors.unshift({ id: node.id, title: node.title });
    cursor = node.parentId;
  }

  // Deep trails collapse to first › … › last so the header stays one line.
  const first = ancestors[0];
  const last = ancestors[ancestors.length - 1];
  const trail: ({ id: string; title: string } | "ellipsis")[] =
    ancestors.length > 3 && first && last ? [first, "ellipsis", last] : ancestors;

  return (
    <Breadcrumb>
      <BreadcrumbList className="text-[13px] font-medium">
        <BreadcrumbItem>
          {space ? (
            <BreadcrumbLink render={<Link to="/spaces/$slug" params={{ slug: space.slug }} />}>
              {space.name}
            </BreadcrumbLink>
          ) : (
            <BreadcrumbLink render={<Link to="/" />}>Übersicht</BreadcrumbLink>
          )}
        </BreadcrumbItem>
        {trail.map((item, index) => (
          <Fragment key={item === "ellipsis" ? `ellipsis-${index}` : item.id}>
            <BreadcrumbSeparator />
            <BreadcrumbItem>
              {item === "ellipsis" ? (
                <BreadcrumbEllipsis />
              ) : (
                <BreadcrumbLink
                  className="inline-block max-w-40 truncate"
                  render={<Link to="/pages/$id" params={{ id: item.id }} />}
                >
                  {item.title || "Ohne Titel"}
                </BreadcrumbLink>
              )}
            </BreadcrumbItem>
          </Fragment>
        ))}
        <BreadcrumbSeparator />
        <BreadcrumbItem>
          <BreadcrumbPage className="max-w-52 truncate">
            {page.title || "Ohne Titel"}
          </BreadcrumbPage>
        </BreadcrumbItem>
      </BreadcrumbList>
    </Breadcrumb>
  );
}
