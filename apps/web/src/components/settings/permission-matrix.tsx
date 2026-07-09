import { useState } from "react";
import type { PermissionRequest } from "@nilovon-wiki/auth/permissions";
import { ChevronDown, ShieldAlert } from "lucide-react";

import {
  PERMISSION_GROUPS,
  hasDangerousGrants,
  type PermissionResource,
} from "@/lib/permission-catalog";
import { Checkbox } from "@nilovon-wiki/ui/components/checkbox";
import { cn } from "@nilovon-wiki/ui/lib/utils";

type PermMap = Record<string, string[]>;

function withAction(
  value: PermissionRequest,
  resource: string,
  action: string,
  checked: boolean,
): PermissionRequest {
  const map = value as PermMap;
  const current = new Set(map[resource] ?? []);
  if (checked) current.add(action);
  else current.delete(action);
  const next: PermMap = { ...map };
  if (current.size > 0) next[resource] = Array.from(current);
  else delete next[resource];
  return next as PermissionRequest;
}

function withResource(
  value: PermissionRequest,
  resource: PermissionResource,
  checked: boolean,
): PermissionRequest {
  const map = value as PermMap;
  const next: PermMap = { ...map };
  if (checked) next[resource.resource] = resource.actions.map((action) => action.action);
  else delete next[resource.resource];
  return next as PermissionRequest;
}

function ResourceRow({
  resource,
  value,
  onChange,
}: {
  resource: PermissionResource;
  value: PermissionRequest;
  onChange: (next: PermissionRequest) => void;
}) {
  const granted = new Set((value as PermMap)[resource.resource] ?? []);
  const allChecked = granted.size === resource.actions.length;
  const someChecked = granted.size > 0 && !allChecked;

  return (
    <div className="rounded-lg border border-border p-3">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="text-sm font-medium">{resource.label}</div>
          <div className="text-xs text-muted-foreground">{resource.description}</div>
        </div>
        <label
          className="flex shrink-0 items-center gap-2 text-xs text-muted-foreground"
          htmlFor={`all-${resource.resource}`}
        >
          Alle
          <Checkbox
            id={`all-${resource.resource}`}
            checked={allChecked}
            indeterminate={someChecked}
            onCheckedChange={(checked) => onChange(withResource(value, resource, checked === true))}
          />
        </label>
      </div>
      <div className="mt-3 flex flex-wrap gap-x-4 gap-y-2">
        {resource.actions.map((action) => (
          <label
            key={action.action}
            className="flex cursor-pointer items-center gap-2 text-sm"
            htmlFor={`${resource.resource}-${action.action}`}
          >
            <Checkbox
              id={`${resource.resource}-${action.action}`}
              checked={granted.has(action.action)}
              onCheckedChange={(checked) =>
                onChange(withAction(value, resource.resource, action.action, checked === true))
              }
            />
            {action.label}
          </label>
        ))}
      </div>
    </div>
  );
}

/**
 * The grantable permission grid for a group. Content permissions are always
 * visible; org-management ("dangerous") permissions sit behind a warning and an
 * explicit reveal, because granting them lets the group manage other members and
 * roles — a privilege-escalation surface.
 */
export function PermissionMatrix({
  value,
  onChange,
}: {
  value: PermissionRequest;
  onChange: (next: PermissionRequest) => void;
}) {
  const [showDangerous, setShowDangerous] = useState(() => hasDangerousGrants(value));

  return (
    <div className="space-y-6">
      {PERMISSION_GROUPS.map((group) => {
        if (!group.dangerous) {
          return (
            <section key={group.key} className="space-y-3">
              <div>
                <h3 className="text-sm font-semibold">{group.label}</h3>
                <p className="text-xs text-muted-foreground">{group.description}</p>
              </div>
              <div className="space-y-2">
                {group.resources.map((resource) => (
                  <ResourceRow
                    key={resource.resource}
                    resource={resource}
                    value={value}
                    onChange={onChange}
                  />
                ))}
              </div>
            </section>
          );
        }

        return (
          <section
            key={group.key}
            className="space-y-3 rounded-xl border border-amber-500/30 bg-amber-500/5 p-3"
          >
            <button
              type="button"
              className="flex w-full items-start justify-between gap-3 text-left"
              onClick={() => setShowDangerous((prev) => !prev)}
            >
              <div className="flex items-start gap-2">
                <ShieldAlert className="mt-0.5 size-4 shrink-0 text-amber-600 dark:text-amber-500" />
                <div>
                  <h3 className="text-sm font-semibold">{group.label} · Erweiterte Rechte</h3>
                  <p className="text-xs text-amber-700 dark:text-amber-400">{group.description}</p>
                </div>
              </div>
              <ChevronDown
                className={cn(
                  "mt-0.5 size-4 shrink-0 text-muted-foreground transition-transform",
                  showDangerous && "rotate-180",
                )}
              />
            </button>
            {showDangerous ? (
              <div className="space-y-2">
                {group.resources.map((resource) => (
                  <ResourceRow
                    key={resource.resource}
                    resource={resource}
                    value={value}
                    onChange={onChange}
                  />
                ))}
              </div>
            ) : null}
          </section>
        );
      })}
    </div>
  );
}
