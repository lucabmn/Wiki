import { Route } from "@/routes/_auth";
import { authClient } from "@/lib/auth-client";
import { orpc } from "@/utils/orpc";
import { CreateSpaceDialog } from "./create-space-dialog";
import { CreatePageDialog } from "./create-page-dialog";
import { Avatar, AvatarFallback } from "@nilovon-wiki/ui/components/avatar";
import { Button } from "@nilovon-wiki/ui/components/button";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@nilovon-wiki/ui/components/collapsible";
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
  SidebarMenuSub,
  SidebarMenuSubButton,
  SidebarMenuSubItem,
} from "@nilovon-wiki/ui/components/sidebar";
import { useQuery } from "@tanstack/react-query";
import {
  ChevronRight,
  ChevronsUpDown,
  FileText,
  Folder,
  Home,
  LayoutGrid,
  Lock,
  Moon,
  Plus,
  Search,
  Sun,
} from "lucide-react";
import { useState } from "react";
import { useTheme } from "./theme-provider";
import { Link, linkOptions, useMatchRoute } from "@tanstack/react-router";

const nav = linkOptions([
  { to: "/", label: "Übersicht", icon: Home },
  { to: "/template", label: "Alle Spaces", icon: LayoutGrid },
  { to: "/template", label: "Mitglieder & Rechte", icon: Lock },
]);

function ColorAvatar({
  initials,
  color,
  size = "default",
  className,
}: {
  initials: string;
  color: string;
  size?: "default" | "sm" | "lg";
  className?: string;
}) {
  return (
    <Avatar size={size} className={className}>
      <AvatarFallback style={{ backgroundColor: color, color: "#fff" }} className="font-semibold">
        {initials}
      </AvatarFallback>
    </Avatar>
  );
}

/** Top-level pages of one space, loaded lazily when the space is expanded. */
function SpacePages({
  spaceId,
  activePage,
  onSelectPage,
}: {
  spaceId: string;
  activePage: string | null;
  onSelectPage: (id: string) => void;
}) {
  const { data: pages, isPending } = useQuery(
    orpc.pages.list.queryOptions({ input: { spaceId, parentId: null } }),
  );

  if (isPending) {
    return (
      <SidebarMenuSub className="mr-0 pr-0">
        {[0, 1, 2].map((i) => (
          <SidebarMenuSubItem key={i}>
            <Skeleton className="mx-2 my-1 h-5 w-32" />
          </SidebarMenuSubItem>
        ))}
      </SidebarMenuSub>
    );
  }

  if (!pages?.length) {
    return (
      <SidebarMenuSub className="mr-0 pr-0">
        <SidebarMenuSubItem>
          <span className="px-2 py-1 text-[12px] text-muted-foreground">Keine Seiten</span>
        </SidebarMenuSubItem>
      </SidebarMenuSub>
    );
  }

  return (
    <SidebarMenuSub className="mr-0 pr-0">
      {pages.map((page) => (
        <SidebarMenuSubItem key={page.id}>
          <SidebarMenuSubButton
            isActive={activePage === page.id}
            onClick={() => onSelectPage(page.id)}
            className="cursor-pointer data-active:bg-primary/10 data-active:text-primary"
          >
            {page.icon ? <span className="text-sm leading-none">{page.icon}</span> : <FileText />}
            <span>{page.title}</span>
          </SidebarMenuSubButton>
        </SidebarMenuSubItem>
      ))}
    </SidebarMenuSub>
  );
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
              <SpacePages spaceId={space.id} activePage={activePage} onSelectPage={onSelectPage} />
            </CollapsibleContent>
          </SidebarMenuItem>
        </Collapsible>
      ))}
      <CreatePageDialog
        spaceId={createPageSpaceId}
        onOpenChange={(open) => {
          if (!open) setCreatePageSpaceId(null);
        }}
      />
    </SidebarMenu>
  );
}

export default function MainSidebar() {
  const { auth } = Route.useRouteContext();
  const { theme, setTheme } = useTheme();

  const [activePage, setActivePage] = useState<string | null>(null);
  const [createSpaceOpen, setCreateSpaceOpen] = useState(false);

  const matchRoute = useMatchRoute();

  return (
    <Sidebar collapsible="none" className="border-r border-border">
      <SidebarHeader className="gap-0">
        <button
          type="button"
          className="flex items-center gap-2.5 rounded-xl px-2 py-1.5 text-left transition-colors hover:bg-sidebar-accent"
        >
          <div className="flex size-9 shrink-0 items-center justify-center rounded-xl bg-primary text-[15px] font-bold text-primary-foreground shadow-sm">
            {auth.organization.name.charAt(0).toUpperCase()}
          </div>
          <div className="min-w-0 flex-1">
            <div className="truncate text-sm leading-tight font-semibold">
              {auth.organization.name}
            </div>
            <div className="text-[11.5px] leading-tight text-muted-foreground">Wissens-Hub</div>
          </div>
          <ChevronsUpDown className="size-4 text-muted-foreground" />
        </button>

        <div className="px-2 pt-2">
          <Button
            variant="outline"
            onClick={() => console.log("cmdk + k")}
            className="h-9 w-full justify-start gap-2.5 px-2.5 font-normal text-muted-foreground"
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
          <SpacesTree activePage={activePage} onSelectPage={setActivePage} />
        </SidebarGroup>
      </SidebarContent>

      <SidebarFooter className="flex-row items-center gap-2.5 border-t border-border">
        <ColorAvatar
          initials={
            auth.session.user.name
              .split(" ")
              .map((w) => w[0])
              .slice(0, 2)
              .join("")
              .toUpperCase() || "SK"
          }
          color="#8b5cf6"
          size="sm"
        />
        <div className="min-w-0 flex-1">
          <div className="truncate text-[13px] leading-tight font-semibold">
            {auth.session.user.name}
          </div>
          <div className="flex items-center gap-1 text-[11px] text-muted-foreground">
            <span className="size-1.5 rounded-full bg-emerald-500" />
            Editor · Online
          </div>
        </div>
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
    </Sidebar>
  );
}
