import { Link } from "@tanstack/react-router";

import { cn } from "@nilovon-wiki/ui/lib/utils";

/**
 * A person's name, linked to their profile. Renders plain text when the id is
 * missing — user references are `ON DELETE SET NULL`, so an authored record can
 * outlive its author.
 */
export function UserLink({
  userId,
  name,
  className,
}: {
  userId: string | null | undefined;
  name: string;
  className?: string;
}) {
  if (!userId) return <span className={className}>{name}</span>;
  return (
    <Link
      to="/users/$id"
      params={{ id: userId }}
      className={cn("hover:text-primary hover:underline", className)}
    >
      {name}
    </Link>
  );
}
