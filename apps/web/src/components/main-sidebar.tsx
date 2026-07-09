import { authClient } from "@/lib/auth-client";
import { initials } from "@/lib/format";
import { checkStaticRolePermission, usePermission } from "@/lib/permissions";
import { orpc } from "@/utils/orpc";
import { PageTree } from "./page-tree/page-tree";
import { CommandPalette } from "./command-palette";
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
  Moon,
  Plus,
  Search,
  Settings,
  Sun,
} from "lucide-react";
import { useState } from "react";
import { useTheme } from "./theme-provider";
import {
  Link,
  linkOptions,
  useMatchRoute,
  useNavigate,
  useRouteContext,
} from "@tanstack/react-router";

const baseNav = linkOptions([
  { to: "/", label: "Übersicht", icon: Home },
  { to: "/spaces", label: "Alle Spaces", icon: LayoutGrid },
]);

const settingsNavItem = {
  to: "/settings/members",
  label: "Einstellungen",
  icon: Settings,
} as const;

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

  const { data: spaces, isPending } = useQuery(
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
        <Collapsible key={space.id} defaultOpen={index === 0} className="group/collapsible">
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
  const { theme, setTheme } = useTheme();

  // Show the settings entry only to members who can manage people or roles. The
  // static role suffices here (owner/admin hold these grants); the settings
  // route re-guards and the server enforces every mutation regardless.
  const myRole =
    auth.organization.members.find((member) => member.user.id === auth.session.user.id)?.role ?? "";
  const canManageOrg =
    checkStaticRolePermission({ member: ["update"] }, myRole) ||
    checkStaticRolePermission({ ac: ["create"] }, myRole);
  const nav = canManageOrg ? [...baseNav, settingsNavItem] : baseNav;

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

        <div className="px-2 pt-2">
          <Button
            variant="outline"
            onClick={() => setSearchOpen(true)}
            className="h-8 w-full justify-start gap-2.5 px-2.5 font-normal text-muted-foreground"
          >
            <Search className="size-4" />
            <span className="flex-1 text-left">Suchen …</span>
            <Kbd>⌘K</Kbd>
          </Button>
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
            <DropdownMenuLabel className="truncate">{auth.session.user.email}</DropdownMenuLabel>
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
