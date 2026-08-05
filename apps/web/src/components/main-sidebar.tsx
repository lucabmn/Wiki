import { authClient } from "@/lib/auth-client";
import { initials } from "@/lib/format";
import { isInstanceAdminSession } from "@/lib/instance-admin";
import { usePermission } from "@/lib/permissions";
import { orpc } from "@/utils/orpc";
import { NotificationBell } from "./inbox/notification-bell";
import { PageTree } from "./page-tree/page-tree";
import { CommandPalette } from "./command-palette";
import { QueryError } from "./query-error";
import { CreateSpaceDialog } from "./create-space-dialog";
import { CreatePageDialog } from "./create-page-dialog";
import { Avatar, AvatarFallback } from "@nilovon-wiki/ui/components/avatar";
import { Button } from "@nilovon-wiki/ui/components/button";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@nilovon-wiki/ui/components/collapsible";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@nilovon-wiki/ui/components/dropdown-menu";
import { Kbd } from "@nilovon-wiki/ui/components/kbd";
import { Skeleton } from "@nilovon-wiki/ui/components/skeleton";
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupAction,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuAction,
  SidebarMenuButton,
  SidebarMenuItem,
} from "@nilovon-wiki/ui/components/sidebar";
import { useQuery } from "@tanstack/react-query";
import {
  Check,
  ChevronRight,
  ChevronsUpDown,
  Folder,
  Home,
  LayoutGrid,
  LogOut,
  Tags,
  Moon,
  Plus,
  Search,
  Settings,
  ShieldAlert,
  Sun,
  User,
  UsersRound,
} from "lucide-react";
import { useState } from "react";
import { useTheme } from "./theme-provider";
import { Link, useMatchRoute, useNavigate, useRouteContext } from "@tanstack/react-router";

const baseNav = [
  { to: "/", label: "Übersicht", icon: Home },
  { to: "/spaces", label: "Alle Spaces", icon: LayoutGrid },
  { to: "/tags", label: "Tags", icon: Tags },
  { to: "/users", label: "Personen", icon: UsersRound },
] as const;

const settingsNavItem = {
  to: "/settings/profile",
  label: "Einstellungen",
  icon: Settings,
} as const;

/**
 * Instance administration — a different axis from the organization settings
 * above, so it gets its own entry rather than a tab inside them. Hidden for
 * everyone else, but that is cosmetic: the route and every procedure behind it
 * re-check server-side.
 */
const adminNavItem = {
  to: "/admin",
  label: "Instanz-Verwaltung",
  icon: ShieldAlert,
} as const;

const SPACE_OPEN_STATE_STORAGE_PREFIX = "nilovon-wiki:sidebar:space-open-state";

type SpaceOpenState = {
  organizationId: string | null;
  openBySpaceId: Map<string, boolean>;
};

function spaceOpenStateStorageKey(organizationId: string) {
  return `${SPACE_OPEN_STATE_STORAGE_PREFIX}:${organizationId}`;
}

function readSpaceOpenState(organizationId: string | null): SpaceOpenState {
  if (!organizationId || typeof window === "undefined") {
    return { organizationId, openBySpaceId: new Map() };
  }

  try {
    const raw = window.localStorage.getItem(spaceOpenStateStorageKey(organizationId));
    const parsed: unknown = raw ? JSON.parse(raw) : {};
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      return { organizationId, openBySpaceId: new Map() };
    }

    return {
      organizationId,
      openBySpaceId: new Map(
        Object.entries(parsed).filter(
          (entry): entry is [string, boolean] => typeof entry[1] === "boolean",
        ),
      ),
    };
  } catch {
    return { organizationId, openBySpaceId: new Map() };
  }
}

function writeSpaceOpenState(organizationId: string, openBySpaceId: Map<string, boolean>) {
  if (typeof window === "undefined") return;

  try {
    window.localStorage.setItem(
      spaceOpenStateStorageKey(organizationId),
      JSON.stringify(Object.fromEntries(openBySpaceId)),
    );
  } catch {
    // Storage can be unavailable (for example in private browsing). The current
    // render state still updates; it just will not survive a refresh.
  }
}

/** The space list for the active organization; each space expands to its pages. */
function SpacesTree({
  activePage,
  onSelectPage,
}: {
  activePage: string | null;
  onSelectPage: (id: string) => void;
}) {
  const { data: session } = authClient.useSession();
  const activeOrgId = session?.session.activeOrganizationId ?? null;
  const { allowed: canReorder } = usePermission({ page: ["move"] });
  const [createPageSpaceId, setCreatePageSpaceId] = useState<string | null>(null);
  const [spaceOpenState, setSpaceOpenState] = useState<SpaceOpenState>(() =>
    readSpaceOpenState(activeOrgId),
  );
  const effectiveSpaceOpenState =
    spaceOpenState.organizationId === activeOrgId
      ? spaceOpenState
      : readSpaceOpenState(activeOrgId);

  const {
    data: spaces,
    isPending,
    isError,
    error,
    refetch,
  } = useQuery(
    orpc.spaces.list.queryOptions({
      input: { includeArchived: false },
      enabled: Boolean(activeOrgId),
    }),
  );

  if (!activeOrgId) {
    return (
      <p className="px-2 py-1.5 text-[12px] text-muted-foreground">Keine Organisation aktiv.</p>
    );
  }

  if (isPending) {
    return (
      <SidebarMenu className="gap-0.5">
        {[0, 1, 2].map((i) => (
          <SidebarMenuItem key={i}>
            <Skeleton className="mx-2 my-1 h-7 w-40" />
          </SidebarMenuItem>
        ))}
      </SidebarMenu>
    );
  }

  if (isError) {
    return <QueryError compact error={error} onRetry={() => refetch()} />;
  }

  if (!spaces?.length) {
    return (
      <p className="px-2 py-1.5 text-[12px] text-muted-foreground">
        Noch keine Spaces. Lege einen an, um loszulegen.
      </p>
    );
  }

  return (
    <SidebarMenu className="gap-0.5">
      {spaces.map((space, index) => (
        <Collapsible
          key={space.id}
          open={effectiveSpaceOpenState.openBySpaceId.get(space.id) ?? index === 0}
          onOpenChange={(open) => {
            if (!activeOrgId) return;

            setSpaceOpenState((current) => {
              const currentOpenBySpaceId =
                current.organizationId === activeOrgId
                  ? current.openBySpaceId
                  : new Map<string, boolean>();
              const openBySpaceId = new Map(currentOpenBySpaceId);
              openBySpaceId.set(space.id, open);
              writeSpaceOpenState(activeOrgId, openBySpaceId);
              return { organizationId: activeOrgId, openBySpaceId };
            });
          }}
          className="group/collapsible"
        >
          <SidebarMenuItem>
            {/* Chevron toggles the page tree; the rest of the row navigates to
                the space — kept as siblings so neither nests inside the other. */}
            <CollapsibleTrigger
              render={
                <SidebarMenuAction title="Ein-/ausklappen" className="right-auto left-1">
                  <ChevronRight className="transition-transform group-data-open/collapsible:rotate-90" />
                  <span className="sr-only">Ein-/ausklappen</span>
                </SidebarMenuAction>
              }
            />
            <SidebarMenuButton
              className="pl-8 font-medium text-muted-foreground"
              render={
                <Link to="/spaces/$slug" params={{ slug: space.slug }}>
                  {space.icon ? (
                    <span className="text-sm leading-none">{space.icon}</span>
                  ) : (
                    <Folder style={space.color ? { color: space.color } : undefined} />
                  )}
                  <span>{space.name}</span>
                </Link>
              }
            />
            <SidebarMenuAction
              title="Neue Seite"
              showOnHover
              onClick={() => setCreatePageSpaceId(space.id)}
            >
              <Plus /> <span className="sr-only">Neue Seite</span>
            </SidebarMenuAction>
            <CollapsibleContent>
              <PageTree
                spaceId={space.id}
                activePage={activePage}
                canReorder={canReorder}
                onSelectPage={onSelectPage}
              />
            </CollapsibleContent>
          </SidebarMenuItem>
        </Collapsible>
      ))}
      <CreatePageDialog
        open={createPageSpaceId !== null}
        spaceId={createPageSpaceId}
        onOpenChange={(open) => {
          if (!open) setCreatePageSpaceId(null);
        }}
      />
    </SidebarMenu>
  );
}

export default function MainSidebar() {
  // Read auth context from the _auth LAYOUT route (active on every child) via the
  // route id — importing the route module here would be a circular import, since
  // the layout route renders this sidebar.
  const { auth } = useRouteContext({ from: "/_auth" });
  const { data: session } = authClient.useSession();
  const { theme, setTheme } = useTheme();

  // Settings is open to everyone: it starts on the personal tabs (profile,
  // security, appearance). The organization tabs inside it are gated separately.
  const nav = isInstanceAdminSession(session)
    ? [...baseNav, settingsNavItem, adminNavItem]
    : [...baseNav, settingsNavItem];

  const [createSpaceOpen, setCreateSpaceOpen] = useState(false);
  const [searchOpen, setSearchOpen] = useState(false);

  const matchRoute = useMatchRoute();
  const navigate = useNavigate();

  // Highlight the open page by reading it back off the route, so the tree stays
  // in sync on deep-links and back/forward — not just clicks.
  const pageMatch = matchRoute({ to: "/pages/$id" });
  const activePage = pageMatch ? pageMatch.id : null;

  // All content is org-scoped, so a switch does a full reload: every query
  // cache and route loader starts fresh in the new organization.
  const { data: organizations } = authClient.useListOrganizations();
  const switchOrganization = async (organizationId: string) => {
    if (organizationId === auth.organization.id) return;
    await authClient.organization.setActive({ organizationId });
    window.location.assign("/");
  };

  const signOut = async () => {
    await authClient.signOut();
    window.location.assign("/auth/login");
  };

  return (
    <Sidebar collapsible="offcanvas" className="border-r border-border">
      <SidebarHeader className="gap-0">
        <DropdownMenu>
          <DropdownMenuTrigger
            render={
              <button
                type="button"
                className="flex w-full items-center gap-2.5 rounded-xl px-2 py-1.5 text-left transition-colors hover:bg-sidebar-accent"
              >
                <div className="flex size-8 shrink-0 items-center justify-center rounded-xl bg-primary text-[15px] font-bold text-primary-foreground shadow-sm">
                  {auth.organization.name.charAt(0).toUpperCase()}
                </div>
                <div className="min-w-0 flex-1">
                  <div className="truncate text-sm leading-tight font-semibold">
                    {auth.organization.name}
                  </div>
                  <div className="text-[11.5px] leading-tight text-muted-foreground">
                    Wissens-Hub
                  </div>
                </div>
                <ChevronsUpDown className="size-4 text-muted-foreground" />
              </button>
            }
          />
          <DropdownMenuContent align="start" className="w-60">
            <DropdownMenuGroup>
              <DropdownMenuLabel>Organisation wechseln</DropdownMenuLabel>
              {(organizations ?? [auth.organization]).map((org) => (
                <DropdownMenuItem key={org.id} onClick={() => switchOrganization(org.id)}>
                  <span className="flex size-5 shrink-0 items-center justify-center rounded-md bg-primary/10 text-[11px] font-bold text-primary">
                    {org.name.charAt(0).toUpperCase()}
                  </span>
                  <span className="min-w-0 flex-1 truncate">{org.name}</span>
                  {org.id === auth.organization.id ? <Check className="size-4" /> : null}
                </DropdownMenuItem>
              ))}
            </DropdownMenuGroup>
            <DropdownMenuSeparator />
            <DropdownMenuItem
              render={
                <Link to="/auth/onboarding">
                  <Plus className="size-4" />
                  <span>Neue Organisation</span>
                </Link>
              }
            />
          </DropdownMenuContent>
        </DropdownMenu>

        <div className="flex items-center gap-1.5 px-2 pt-2">
          <Button
            variant="outline"
            onClick={() => setSearchOpen(true)}
            className="h-8 min-w-0 flex-1 justify-start gap-2.5 px-2.5 font-normal text-muted-foreground"
          >
            <Search className="size-4" />
            <span className="flex-1 text-left">Suchen …</span>
            <Kbd>⌘K</Kbd>
          </Button>
          <NotificationBell />
        </div>
      </SidebarHeader>

      <SidebarContent>
        <SidebarGroup className="gap-0.5 py-1">
          <SidebarMenu>
            {nav.map((item) => (
              <SidebarMenuItem key={`${item.to}-${item.label}`}>
                <SidebarMenuButton
                  isActive={!!matchRoute({ to: item.to })}
                  className="data-active:bg-primary/10 data-active:font-medium data-active:text-primary"
                  render={
                    <Link to={item.to}>
                      <item.icon />
                      <span>{item.label}</span>
                    </Link>
                  }
                />
              </SidebarMenuItem>
            ))}
          </SidebarMenu>
        </SidebarGroup>

        <SidebarGroup>
          <SidebarGroupLabel>Spaces</SidebarGroupLabel>
          <SidebarGroupAction title="Neuer Space" onClick={() => setCreateSpaceOpen(true)}>
            <Plus /> <span className="sr-only">Neuer Space</span>
          </SidebarGroupAction>
          <SpacesTree
            activePage={activePage}
            onSelectPage={(id) => navigate({ to: "/pages/$id", params: { id } })}
          />
        </SidebarGroup>
      </SidebarContent>

      <SidebarFooter className="flex-row items-center gap-1 border-t border-border">
        <DropdownMenu>
          <DropdownMenuTrigger
            render={
              <button
                type="button"
                title="Konto"
                className="flex min-w-0 flex-1 items-center gap-2.5 rounded-lg px-1.5 py-1 text-left transition-colors hover:bg-sidebar-accent"
              >
                <Avatar size="sm">
                  <AvatarFallback className="font-semibold">
                    {initials(auth.session.user.name)}
                  </AvatarFallback>
                </Avatar>
                <div className="min-w-0 flex-1">
                  <div className="truncate text-[13px] leading-tight font-semibold">
                    {auth.session.user.name}
                  </div>
                  <div className="truncate text-[11px] text-muted-foreground">
                    {auth.session.user.email}
                  </div>
                </div>
              </button>
            }
          />
          <DropdownMenuContent align="start" side="top" className="w-56">
            <DropdownMenuGroup>
              <DropdownMenuLabel className="truncate">{auth.session.user.email}</DropdownMenuLabel>
              <DropdownMenuItem
                render={
                  <Link to="/users/$id" params={{ id: auth.session.user.id }}>
                    <User className="size-4" />
                    <span>Mein Profil</span>
                  </Link>
                }
              />
            </DropdownMenuGroup>
            <DropdownMenuSeparator />
            <DropdownMenuItem variant="destructive" onClick={signOut}>
              <LogOut className="size-4" />
              <span>Abmelden</span>
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
        <Button
          variant="ghost"
          size="icon-sm"
          title="Theme wechseln"
          onClick={() => setTheme(theme === "dark" ? "light" : "dark")}
        >
          {theme === "light" ? <Sun /> : <Moon />}
        </Button>
      </SidebarFooter>

      <CreateSpaceDialog open={createSpaceOpen} onOpenChange={setCreateSpaceOpen} />
      <CommandPalette open={searchOpen} onOpenChange={setSearchOpen} />
    </Sidebar>
  );
}
