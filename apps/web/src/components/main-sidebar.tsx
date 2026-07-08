import { Route } from "@/routes/_auth";
import { Avatar, AvatarFallback } from "@nilovon-wiki/ui/components/avatar";
import { Button } from "@nilovon-wiki/ui/components/button";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@nilovon-wiki/ui/components/collapsible";
import { Kbd } from "@nilovon-wiki/ui/components/kbd";
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupAction,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarMenuSub,
  SidebarMenuSubButton,
  SidebarMenuSubItem,
} from "@nilovon-wiki/ui/components/sidebar";
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

const tree = [
  {
    id: "onboarding",
    label: "Onboarding",
    pages: [
      ["willkommen", "Willkommen"],
      ["erste-schritte", "Erste Schritte bei Nordwind"],
      ["it-setup", "IT-Setup"],
    ],
  },
  {
    id: "prozesse",
    label: "Prozesse",
    pages: [
      ["urlaub", "Urlaub & Abwesenheit"],
      ["spesen", "Spesenabrechnung"],
      ["codereview", "Code-Review-Richtlinien"],
    ],
  },
  {
    id: "unternehmen",
    label: "Unternehmen",
    pages: [
      ["leitbild", "Leitbild & Werte"],
      ["orgchart", "Organigramm"],
      ["benefits", "Benefits"],
    ],
  },
] as const;

const defaultOpen: Record<string, boolean> = {
  onboarding: true,
  prozesse: true,
  unternehmen: false,
};

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

export default function MainSidebar() {
  const { auth } = Route.useRouteContext();
  const { theme, setTheme } = useTheme();

  const [activePage, setActivePage] = useState("erste-schritte");

  const matchRoute = useMatchRoute();

  return (
    <Sidebar collapsible="none" className="border-r border-border">
      <SidebarHeader className="gap-0">
        <button
          type="button"
          className="flex items-center gap-2.5 rounded-xl px-2 py-1.5 text-left transition-colors hover:bg-sidebar-accent"
        >
          <div className="flex size-9 shrink-0 items-center justify-center rounded-xl bg-primary text-[15px] font-bold text-primary-foreground shadow-sm">
            N
          </div>
          <div className="min-w-0 flex-1">
            <div className="text-sm leading-tight font-semibold">Nordwind GmbH</div>
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
          <SidebarGroupLabel>Team-Handbuch</SidebarGroupLabel>
          <SidebarGroupAction title="Neue Seite">
            <Plus /> <span className="sr-only">Neue Seite</span>
          </SidebarGroupAction>
          <SidebarMenu className="gap-0.5">
            {tree.map((sec) => (
              <Collapsible
                key={sec.id}
                defaultOpen={defaultOpen[sec.id]}
                className="group/collapsible"
              >
                <SidebarMenuItem>
                  <CollapsibleTrigger
                    render={
                      <SidebarMenuButton className="font-medium text-muted-foreground">
                        <ChevronRight className="transition-transform group-data-open/collapsible:rotate-90" />
                        <Folder />
                        <span>{sec.label}</span>
                      </SidebarMenuButton>
                    }
                  />
                  <CollapsibleContent>
                    <SidebarMenuSub className="mr-0 pr-0">
                      {sec.pages.map(([pid, plabel]) => {
                        const active = activePage === pid;
                        return (
                          <SidebarMenuSubItem key={pid}>
                            <SidebarMenuSubButton
                              isActive={active}
                              onClick={() => setActivePage(pid)}
                              className="cursor-pointer data-active:bg-primary/10 data-active:text-primary"
                            >
                              <FileText />
                              <span>{plabel}</span>
                            </SidebarMenuSubButton>
                          </SidebarMenuSubItem>
                        );
                      })}
                    </SidebarMenuSub>
                  </CollapsibleContent>
                </SidebarMenuItem>
              </Collapsible>
            ))}
          </SidebarMenu>
        </SidebarGroup>
      </SidebarContent>

      <SidebarFooter className="flex-row items-center gap-2.5 border-t border-border">
        <ColorAvatar
          initials={
            auth.user.name
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
          <div className="truncate text-[13px] leading-tight font-semibold">{auth.user.name}</div>
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
    </Sidebar>
  );
}
