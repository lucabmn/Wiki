import { createFileRoute } from "@tanstack/react-router";
import { cn } from "@nilovon-wiki/ui/lib/utils";
import { Avatar, AvatarFallback, AvatarGroup } from "@nilovon-wiki/ui/components/avatar";
import { Badge } from "@nilovon-wiki/ui/components/badge";
import {
  Breadcrumb,
  BreadcrumbItem,
  BreadcrumbList,
  BreadcrumbPage,
  BreadcrumbSeparator,
} from "@nilovon-wiki/ui/components/breadcrumb";
import { Button } from "@nilovon-wiki/ui/components/button";
import { Card, CardContent } from "@nilovon-wiki/ui/components/card";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@nilovon-wiki/ui/components/collapsible";
import { Input } from "@nilovon-wiki/ui/components/input";
import { Kbd } from "@nilovon-wiki/ui/components/kbd";
import { Label } from "@nilovon-wiki/ui/components/label";
import {
  NativeSelect,
  NativeSelectOption,
} from "@nilovon-wiki/ui/components/native-select";
import { Separator } from "@nilovon-wiki/ui/components/separator";
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupAction,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarInset,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarMenuSub,
  SidebarMenuSubButton,
  SidebarMenuSubItem,
  SidebarProvider,
} from "@nilovon-wiki/ui/components/sidebar";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@nilovon-wiki/ui/components/table";
import { Tabs, TabsList, TabsTrigger } from "@nilovon-wiki/ui/components/tabs";
import {
  Bold,
  BookOpen,
  ChevronRight,
  ChevronsUpDown,
  Check,
  Code,
  FileText,
  Folder,
  Heading1,
  Heading2,
  History,
  Home,
  Info,
  Italic,
  LayoutGrid,
  Link as LinkIcon,
  List,
  ListOrdered,
  Lock,
  Mail,
  MessageSquare,
  Minus,
  Moon,
  MoreVertical,
  Pencil,
  Pilcrow,
  Plus,
  Quote,
  Search,
  Share2,
  Strikethrough,
  Sun,
  Table as TableIcon,
  ThumbsDown,
  ThumbsUp,
  Underline,
  UserPlus,
  Users,
} from "lucide-react";
// ChevronDown intentionally not imported — tree chevrons use ChevronRight with rotate.
import { type ComponentType, useEffect, useRef, useState } from "react";

export const Route = createFileRoute("/_auth/")({
  component: RouteComponent,
});

/* ---------- shared bits ---------- */

const ROLE_CLASS: Record<string, string> = {
  Administrator: "bg-violet-500/12 text-violet-600 dark:text-violet-300",
  Admin: "bg-violet-500/12 text-violet-600 dark:text-violet-300",
  Editor: "bg-primary/12 text-primary",
  Kommentator: "bg-amber-500/12 text-amber-600 dark:text-amber-300",
  Leser: "bg-muted text-muted-foreground",
};
function RoleBadge({ role, className }: { role: string; className?: string }) {
  return (
    <Badge variant="secondary" className={cn("rounded-md", ROLE_CLASS[role] ?? ROLE_CLASS.Leser, className)}>
      {role}
    </Badge>
  );
}

function ColorAvatar({ initials, color, className }: { initials: string; color: string; className?: string }) {
  return (
    <Avatar className={cn("size-8.5", className)}>
      <AvatarFallback style={{ backgroundColor: color, color: "#fff" }} className="text-[12px] font-bold">
        {initials}
      </AvatarFallback>
    </Avatar>
  );
}

const STATUS_CLASS: Record<string, string> = {
  Aktiv: "text-emerald-600 dark:text-emerald-400",
  Eingeladen: "text-amber-600 dark:text-amber-400",
  Abwesend: "text-muted-foreground",
};

/* ---------- article (read view) ---------- */

function ChecklistRow({ step, done }: { step: string; done: boolean }) {
  return (
    <div className="grid grid-cols-[1fr_120px] border-b border-border last:border-0">
      <div className="px-4 py-2.5">{step}</div>
      <div className={cn("px-4 py-2.5 font-semibold", done ? "text-emerald-600 dark:text-emerald-400" : "text-amber-600 dark:text-amber-400")}>
        {done ? "✓ Erledigt" : "● Offen"}
      </div>
    </div>
  );
}

function Article() {
  const h2 = "mt-9 mb-3.5 scroll-mt-20 font-sans text-2xl font-bold tracking-tight text-foreground";
  return (
    <div className="font-serif text-[18px] leading-[1.72] text-foreground">
      <p className="mb-5.5 text-[19px] text-muted-foreground">
        Schön, dass du da bist! Diese Seite führt dich durch deine ersten Tage bei Nordwind – von der Vorbereitung vor dem
        Start bis zur Einrichtung deiner Arbeitsumgebung. Plane dafür ungefähr eine Stunde ein.
      </p>

      <h2 id="ueberblick" className={h2}>Überblick</h2>
      <p className="mb-5.5">
        Dein Onboarding gliedert sich in drei Phasen. In den ersten Tagen liegt der Fokus auf Orientierung und Setup –
        fachliche Tiefe kommt später ganz von selbst. Bei Fragen ist dein <em>Buddy</em> die erste Anlaufstelle.
      </p>

      <div className="mb-6.5 flex gap-3 rounded-xl border border-primary/25 bg-primary/8 p-4 font-sans text-[14.5px] leading-relaxed">
        <Info className="mt-0.5 size-5 shrink-0 text-primary" />
        <div>
          <b className="font-bold text-foreground">Gut zu wissen:</b> Deinen Buddy findest du im{" "}
          <span className="font-semibold text-primary">Org-Chart</span>. Trag dich außerdem für die wöchentliche
          Onboarding-Runde ein.
        </div>
      </div>

      <h2 id="vorab" className={h2}>Vor dem ersten Tag</h2>
      <p className="mb-4">Idealerweise erledigst du diese Punkte schon im Vorfeld, damit am ersten Tag alles bereitsteht:</p>
      <ul className="mb-5.5 list-disc pl-6">
        <li className="mb-2">Bestätige deine Daten im <b className="font-semibold">People-Portal</b> (Adresse, Bankverbindung, Notfallkontakt).</li>
        <li className="mb-2">Lade ein Profilbild hoch – das hilft Kolleg:innen, dich zuzuordnen.</li>
        <li className="mb-2">Lies das <span className="border-b border-primary/40 font-semibold text-primary">Leitbild &amp; Werte</span>, damit du weißt, wofür wir stehen.</li>
      </ul>

      <h2 id="ersttag" className={h2}>Dein erster Tag</h2>
      <p className="mb-4">
        Um 9:30 Uhr holt dich dein Buddy am Empfang ab. Der Vormittag ist für Setup und Kennenlernen reserviert, am
        Nachmittag folgt eine kurze Tour durchs Büro.
      </p>
      <blockquote className="mb-5.5 border-l-[3px] border-primary py-1 pl-5 text-muted-foreground italic">
        „Niemand erwartet, dass du in Woche eins produktiv bist. Erwarte es auch nicht von dir selbst.“
      </blockquote>

      <h2 id="it-setup" className={h2}>IT-Setup</h2>
      <p className="mb-4">Dein Laptop ist vorkonfiguriert. Melde dich mit deinen Zugangsdaten an und arbeite die folgende Checkliste ab:</p>
      <div className="mb-5.5 overflow-hidden rounded-xl border border-border font-sans text-sm">
        <div className="grid grid-cols-[1fr_120px] border-b border-border bg-muted/50 text-[12.5px] font-semibold text-muted-foreground">
          <div className="px-4 py-2.5">Schritt</div>
          <div className="px-4 py-2.5">Status</div>
        </div>
        <ChecklistRow step="SSO / 2-Faktor aktivieren" done />
        <ChecklistRow step="VPN einrichten" done={false} />
        <ChecklistRow step="Slack & Kalender verbinden" done={false} />
      </div>
      <pre className="mb-5.5 overflow-auto rounded-xl border border-border bg-muted/60 p-4 font-mono text-[13px] leading-relaxed">
        <span className="text-muted-foreground"># VPN-Profil installieren</span>
        {"\n"}brew install nordwind-vpn{"\n"}nordwind-vpn login --sso
      </pre>

      <h2 id="kontakte" className={h2}>Wichtige Kontakte</h2>
      <p className="mb-3.5">Bei Problemen wendest du dich an:</p>
      <ul className="mb-2.5 list-disc pl-6">
        <li className="mb-2"><b className="font-semibold">IT-Support</b> — <span className="font-mono text-sm text-primary">#it-help</span> in Slack</li>
        <li className="mb-2"><b className="font-semibold">People &amp; Culture</b> — Sarah König</li>
      </ul>
    </div>
  );
}

/* ---------- component ---------- */

function RouteComponent() {
  const { auth } = Route.useRouteContext();
  const userName = auth?.user?.name || "Sarah König";
  const firstName = userName.split(" ")[0];
  const initials =
    userName.split(" ").map((w) => w[0]).slice(0, 2).join("").toUpperCase() || "SK";

  const [theme, setTheme] = useState<"light" | "dark">("dark");
  const [view, setView] = useState("dashboard");
  const [activePage, setActivePage] = useState("erste-schritte");
  const [permTab, setPermTab] = useState("members");
  const [histTab, setHistTab] = useState("versions");
  const [showSlash, setShowSlash] = useState(false);
  const [resolved, setResolved] = useState<Record<number, boolean>>({ 0: false, 1: true, 2: false });

  const editorRef = useRef<HTMLDivElement>(null);

  // The app theme toggles the global `.dark` class (root <html> is dark by default).
  useEffect(() => {
    document.documentElement.classList.toggle("dark", theme === "dark");
  }, [theme]);

  const exec = (cmd: string, val?: string) => {
    try {
      document.execCommand(cmd, false, val || undefined);
    } catch {
      /* deprecated but fine for the mock editor */
    }
    editorRef.current?.focus();
  };

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setView("dashboard");
      }
      if (view === "edit" && e.key === "/") setTimeout(() => setShowSlash(true), 0);
      if (e.key === "Escape") setShowSlash(false);
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [view]);

  const selectPage = (id: string) => {
    setActivePage(id);
    setView("read");
  };

  /* ----- data ----- */
  const nav: [string, string, ComponentType<{ className?: string }>][] = [
    ["dashboard", "Dashboard", Home],
    ["spaces", "Alle Spaces", LayoutGrid],
    ["permissions", "Mitglieder & Rechte", Lock],
  ];
  const tree = [
    { id: "onboarding", label: "Onboarding", pages: [["willkommen", "Willkommen"], ["erste-schritte", "Erste Schritte bei Nordwind"], ["it-setup", "IT-Setup"]] },
    { id: "prozesse", label: "Prozesse", pages: [["urlaub", "Urlaub & Abwesenheit"], ["spesen", "Spesenabrechnung"], ["codereview", "Code-Review-Richtlinien"]] },
    { id: "unternehmen", label: "Unternehmen", pages: [["leitbild", "Leitbild & Werte"], ["orgchart", "Organigramm"], ["benefits", "Benefits"]] },
  ] as const;
  const defaultOpen: Record<string, boolean> = { onboarding: true, prozesse: true, unternehmen: false };

  const crumbMap: Record<string, string[]> = {
    dashboard: ["Dashboard"],
    spaces: ["Spaces"],
    read: ["Team-Handbuch", "Onboarding", "Erste Schritte bei Nordwind"],
    edit: ["Team-Handbuch", "Erste Schritte bei Nordwind", "Bearbeiten"],
    permissions: ["Team-Handbuch", "Zugriff"],
    history: ["Team-Handbuch", "Erste Schritte", "Verlauf"],
  };
  const crumbs = crumbMap[view] || ["Dashboard"];

  const stats: [string, string, string, string][] = [
    ["Seiten gesamt", "410", "+12 diese Woche", "text-emerald-600 dark:text-emerald-400"],
    ["Spaces", "6", "Du bist in 6", "text-muted-foreground"],
    ["Offene Kommentare", "7", "2 erwähnen dich", "text-amber-600 dark:text-amber-400"],
    ["Aktive Mitglieder", "24", "5 gerade online", "text-emerald-600 dark:text-emerald-400"],
  ];
  const recent: [string, string, string, string][] = [
    ["Erste Schritte bei Nordwind", "Sarah König · vor 2 Std.", "Team-Handbuch", "#1f6feb"],
    ["Incident-Runbook: API-Gateway", "Tobias Mayer · vor 4 Std.", "Engineering", "#0f766e"],
    ["Q3 Roadmap-Entwurf", "Du · vor 5 Std.", "Produkt", "#7c3aed"],
    ["Benefits & Vergünstigungen", "Lena Brandt · gestern", "People", "#c2410c"],
    ["Marken-Richtlinien 2026", "David Klein · gestern", "Design", "#be185d"],
  ];
  const activity: [string, string, string, string, string, string][] = [
    ["Tobias Mayer", "TM", "#0f766e", "kommentierte", "IT-Setup", "vor 2 Std."],
    ["Lena Brandt", "LB", "#1f6feb", "bearbeitete", "Benefits", "vor 4 Std."],
    ["Sarah König", "SK", "#7c3aed", "erstellte", "VPN-Anleitung", "vor 5 Std."],
    ["David Klein", "DK", "#be185d", "verschob", "Logo-Assets", "gestern"],
    ["Jonas Weber", "JW", "#c2410c", "lud ein", "m.olsen@partner.io", "gestern"],
  ];
  const members: [string, string, string, string, string, string, string][] = [
    ["Lena Brandt", "lena.brandt@nordwind.de", "Leitung", "Administrator", "Aktiv", "LB", "#1f6feb"],
    ["Tobias Mayer", "tobias.mayer@nordwind.de", "Engineering", "Editor", "Aktiv", "TM", "#0f766e"],
    ["Sarah König", "sarah.koenig@nordwind.de", "People & Culture", "Editor", "Aktiv", "SK", "#7c3aed"],
    ["Jonas Weber", "jonas.weber@nordwind.de", "Engineering", "Kommentator", "Aktiv", "JW", "#c2410c"],
    ["David Klein", "david.klein@nordwind.de", "Design", "Editor", "Abwesend", "DK", "#be185d"],
    ["Mara Olsen", "m.olsen@partner.io", "Extern", "Leser", "Eingeladen", "MO", "#b45309"],
  ];
  const roles: [string, string, string, string][] = [
    ["Administrator", "Voller Zugriff inkl. Berechtigungen und Space-Einstellungen.", "1", "bg-violet-500"],
    ["Editor", "Seiten erstellen, bearbeiten, verschieben und löschen.", "3", "bg-primary"],
    ["Kommentator", "Lesen und kommentieren, aber keine Bearbeitung.", "1", "bg-amber-500"],
    ["Leser", "Ausschließlich Lesezugriff auf freigegebene Seiten.", "1", "bg-muted-foreground"],
  ];
  const matrix: [string, boolean[]][] = [
    ["Seiten lesen", [true, true, true, true]],
    ["Kommentieren", [true, true, true, false]],
    ["Seiten bearbeiten", [true, true, false, false]],
    ["Seiten erstellen", [true, true, false, false]],
    ["Seiten löschen", [true, true, false, false]],
    ["Mitglieder verwalten", [true, false, false, false]],
    ["Berechtigungen verwalten", [true, false, false, false]],
    ["Space-Einstellungen", [true, false, false, false]],
  ];
  const pageBadge: Record<string, string> = {
    root: "bg-primary/12 text-primary",
    inherit: "bg-muted text-muted-foreground",
    override: "bg-amber-500/12 text-amber-600 dark:text-amber-300",
    restricted: "bg-destructive/12 text-destructive",
  };
  const pageBadgeText: Record<string, string> = { root: "Space-Standard", inherit: "Geerbt", override: "Überschrieben", restricted: "Eingeschränkt" };
  const pagePerms: [number, string, string, string, string][] = [
    [0, "Team-Handbuch (Space)", "root", "Alle Mitglieder · 4 Rollen", "Bearbeiten"],
    [1, "Onboarding", "inherit", "Geerbt vom Space", "Anpassen"],
    [2, "Erste Schritte bei Nordwind", "inherit", "Geerbt", "Anpassen"],
    [1, "Prozesse", "inherit", "Geerbt vom Space", "Anpassen"],
    [2, "Spesenabrechnung", "restricted", "Nur Leitung + Finance", "Bearbeiten"],
    [1, "Unternehmen", "override", "Schreibgeschützt für Externe", "Bearbeiten"],
  ];
  const invites: [string, string, string, string][] = [
    ["m.olsen@partner.io", "Sarah König", "vor 2 Tagen", "Leser"],
    ["neuer.kollege@nordwind.de", "Lena Brandt", "vor 5 Std.", "Editor"],
    ["praktikum@nordwind.de", "Tobias Mayer", "gestern", "Kommentator"],
  ];
  const versions: [string, string, string, string, string, string, number, number, boolean, boolean][] = [
    ["v14", "Sarah König", "SK", "#7c3aed", "heute, 09:24", "Abschnitt „IT-Setup“ um VPN-Schritte ergänzt", 42, 6, true, false],
    ["v13", "Tobias Mayer", "TM", "#0f766e", "gestern, 16:10", "Tippfehler korrigiert, Slack-Links aktualisiert", 8, 8, false, true],
    ["v12", "Sarah König", "SK", "#7c3aed", "24. Juni, 11:02", "Checkliste neu strukturiert (Tabelle eingefügt)", 60, 14, false, true],
    ["v11", "Lena Brandt", "LB", "#1f6feb", "21. Juni, 08:45", "Seite angelegt", 120, 0, false, true],
  ];
  const comments: [string, string, string, string, string, string, number][] = [
    ["Tobias Mayer", "TM", "#0f766e", "vor 2 Std.", "„IT-Setup“", "Sollten wir hier nicht auch erwähnen, dass der VPN-Zugang erst nach SSO-Freischaltung funktioniert? Das hat letzte Woche für Verwirrung gesorgt.", 0],
    ["Lena Brandt", "LB", "#1f6feb", "gestern", "„Erste Schritte“", "Super überarbeitet, danke! Die neue Checkliste ist viel klarer. 👍", 1],
    ["Jonas Weber", "JW", "#c2410c", "vor 3 Tagen", "„Wichtige Kontakte“", "Können wir noch den Notfall-Kontakt für Hardware-Ausfälle ergänzen?", 2],
  ];
  const spaces: [string, string, string, string, string, string, string, string][] = [
    ["Team-Handbuch", "TH", "#1f6feb", "Onboarding, Prozesse und alles Wissenswerte fürs Team.", "48", "24", "Editor", "vor 2 Std."],
    ["Engineering", "EN", "#0f766e", "Architektur, Runbooks und technische Entscheidungen.", "132", "18", "Administrator", "vor 1 Tag"],
    ["Produkt", "PR", "#7c3aed", "Roadmap, Specs und Nutzer-Research.", "76", "15", "Kommentator", "vor 3 Std."],
    ["People & Culture", "PC", "#c2410c", "Policies, Benefits und Recruiting-Prozesse.", "54", "9", "Leser", "vor 5 Tagen"],
    ["Sales & Marketing", "SM", "#b45309", "Playbooks, Pitch-Material und Kampagnen.", "39", "12", "Editor", "vor 1 Woche"],
    ["Design", "DS", "#be185d", "Guidelines, Komponenten und Marken-Assets.", "61", "7", "Editor", "vor 4 Std."],
  ];
  const toc: [string, string][] = [
    ["Überblick", "ueberblick"], ["Vor dem ersten Tag", "vorab"], ["Dein erster Tag", "ersttag"], ["IT-Setup", "it-setup"], ["Wichtige Kontakte", "kontakte"],
  ];

  const tools: ({ divider: true } | { icon: ComponentType<{ className?: string }>; label: string; run: () => void })[] = [
    { icon: Heading1, label: "Überschrift 1", run: () => exec("formatBlock", "H1") },
    { icon: Heading2, label: "Überschrift 2", run: () => exec("formatBlock", "H2") },
    { icon: Pilcrow, label: "Fließtext", run: () => exec("formatBlock", "P") },
    { divider: true },
    { icon: Bold, label: "Fett", run: () => exec("bold") },
    { icon: Italic, label: "Kursiv", run: () => exec("italic") },
    { icon: Underline, label: "Unterstrichen", run: () => exec("underline") },
    { icon: Strikethrough, label: "Durchgestrichen", run: () => exec("strikeThrough") },
    { divider: true },
    { icon: List, label: "Aufzählung", run: () => exec("insertUnorderedList") },
    { icon: ListOrdered, label: "Nummeriert", run: () => exec("insertOrderedList") },
    { icon: Quote, label: "Zitat", run: () => exec("formatBlock", "BLOCKQUOTE") },
    { divider: true },
    { icon: Code, label: "Code", run: () => exec("formatBlock", "PRE") },
    { icon: LinkIcon, label: "Link einfügen", run: () => exec("createLink", "https://wiki.nordwind.de") },
  ];
  const slashItems: [ComponentType<{ className?: string }>, string, string, () => void][] = [
    [Heading2, "Überschrift", "Große Abschnitts-Überschrift", () => { setShowSlash(false); exec("formatBlock", "H2"); }],
    [Pilcrow, "Text", "Einfacher Absatz", () => { setShowSlash(false); exec("formatBlock", "P"); }],
    [List, "Aufzählung", "Liste mit Punkten", () => { setShowSlash(false); exec("insertUnorderedList"); }],
    [Quote, "Zitat", "Hervorgehobenes Zitat", () => { setShowSlash(false); exec("formatBlock", "BLOCKQUOTE"); }],
    [Code, "Code", "Code-Block", () => { setShowSlash(false); exec("formatBlock", "PRE"); }],
    [TableIcon, "Tabelle", "3×3-Raster einfügen", () => { setShowSlash(false); exec("insertHTML", '<table style="border-collapse:collapse;width:100%;margin:8px 0"><tr><td style="border:1px solid var(--border);padding:8px">&nbsp;</td><td style="border:1px solid var(--border);padding:8px">&nbsp;</td></tr></table>'); }],
  ];

  const cardCls = "rounded-xl border border-border bg-card shadow-sm ring-0";

  return (
    <SidebarProvider className="h-svh min-h-0">
      {/* ============ SIDEBAR ============ */}
      <Sidebar collapsible="none" className="border-r border-border">
        <SidebarHeader className="gap-0">
          <button type="button" className="flex items-center gap-2.5 rounded-lg px-2 py-1.5 text-left hover:bg-sidebar-accent">
            <div className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-linear-to-br from-primary to-blue-800 text-[15px] font-extrabold text-white shadow-sm">N</div>
            <div className="min-w-0 flex-1">
              <div className="text-sm leading-tight font-bold">Nordwind GmbH</div>
              <div className="text-[11.5px] leading-tight text-muted-foreground">Wissens-Hub</div>
            </div>
            <ChevronsUpDown className="size-4 text-muted-foreground" />
          </button>

          <div className="px-2 pt-1">
            <Button
              variant="outline"
              onClick={() => setView("dashboard")}
              className="h-9 w-full justify-start gap-2.5 bg-muted/40 px-2.5 font-normal text-muted-foreground"
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
              {nav.map(([id, label, Icon]) => (
                <SidebarMenuItem key={id}>
                  <SidebarMenuButton isActive={view === id} onClick={() => setView(id)} className="data-active:bg-primary/12 data-active:text-primary">
                    <Icon />
                    <span>{label}</span>
                  </SidebarMenuButton>
                </SidebarMenuItem>
              ))}
            </SidebarMenu>
          </SidebarGroup>

          <SidebarGroup>
            <SidebarGroupLabel>Team-Handbuch</SidebarGroupLabel>
            <SidebarGroupAction title="Neue Seite" onClick={() => setView("edit")}>
              <Plus /> <span className="sr-only">Neue Seite</span>
            </SidebarGroupAction>
            <SidebarMenu className="gap-0.5">
              {tree.map((sec) => (
                <Collapsible key={sec.id} defaultOpen={defaultOpen[sec.id]} className="group/collapsible">
                  <SidebarMenuItem>
                    <CollapsibleTrigger
                      render={
                        <SidebarMenuButton className="font-semibold text-muted-foreground">
                          <ChevronRight className="transition-transform group-data-open/collapsible:rotate-90" />
                          <Folder />
                          <span>{sec.label}</span>
                        </SidebarMenuButton>
                      }
                    />
                    <CollapsibleContent>
                      <SidebarMenuSub className="mr-0 pr-0">
                        {sec.pages.map(([pid, plabel]) => {
                          const active = activePage === pid && view === "read";
                          return (
                            <SidebarMenuSubItem key={pid}>
                              <SidebarMenuSubButton
                                isActive={active}
                                onClick={() => selectPage(pid)}
                                className="cursor-pointer data-active:bg-primary/12 data-active:text-primary"
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
          <ColorAvatar initials={initials} color="#7c3aed" className="size-7" />
          <div className="min-w-0 flex-1">
            <div className="truncate text-[13px] leading-tight font-semibold">{userName}</div>
            <div className="text-[11px] text-muted-foreground">Editor · Online</div>
          </div>
          <Button variant="outline" size="icon-sm" title="Theme wechseln" onClick={() => setTheme((t) => (t === "light" ? "dark" : "light"))}>
            {theme === "light" ? <Sun /> : <Moon />}
          </Button>
        </SidebarFooter>
      </Sidebar>

      {/* ============ MAIN ============ */}
      <SidebarInset className="min-w-0">
        {/* topbar */}
        <header className="flex h-13 shrink-0 items-center gap-3.5 border-b border-border bg-card px-4.5">
          <Breadcrumb className="min-w-0 flex-1">
            <BreadcrumbList>
              {crumbs.map((label, i) => {
                const last = i === crumbs.length - 1;
                return (
                  <BreadcrumbItem key={label}>
                    {last ? (
                      <BreadcrumbPage className="font-bold">{label}</BreadcrumbPage>
                    ) : (
                      <>
                        <span className="text-muted-foreground">{label}</span>
                        <BreadcrumbSeparator />
                      </>
                    )}
                  </BreadcrumbItem>
                );
              })}
            </BreadcrumbList>
          </Breadcrumb>

          <div className="flex items-center gap-2">
            {view === "read" && (
              <>
                <Button variant="outline" size="sm" onClick={() => { setHistTab("versions"); setView("history"); }}>
                  <History /> Verlauf
                </Button>
                <Button size="sm" onClick={() => setView("edit")}>
                  <Pencil /> Bearbeiten
                </Button>
              </>
            )}
            {view === "edit" && (
              <>
                <span className="flex items-center gap-1.5 text-xs text-muted-foreground">
                  <span className="size-1.5 rounded-full bg-emerald-500" />
                  Automatisch gespeichert
                </span>
                <Button variant="outline" size="sm" onClick={() => { setShowSlash(false); setView("read"); }}>Abbrechen</Button>
                <Button size="sm" onClick={() => { setShowSlash(false); setView("read"); }}>Veröffentlichen</Button>
              </>
            )}
            <Button variant="outline" size="icon-sm" title="Neue Seite" onClick={() => setView("edit")}>
              <Plus />
            </Button>
          </div>
        </header>

        {/* view region */}
        <main className="relative flex-1 overflow-y-auto">
          {/* ===== DASHBOARD ===== */}
          {view === "dashboard" && (
            <div className="mx-auto max-w-[1080px] px-10 pt-9 pb-16">
              <div className="mb-1 text-[13px] text-muted-foreground">Mittwoch, 29. Juni</div>
              <h1 className="mb-5.5 text-[28px] font-extrabold tracking-tight">Willkommen zurück, {firstName}</h1>

              <div className="relative mb-7.5">
                <Search className="pointer-events-none absolute top-1/2 left-4 size-[19px] -translate-y-1/2 text-muted-foreground" />
                <Input placeholder="Im gesamten Wissens-Hub suchen — Seiten, Personen, Anhänge …" className="h-12.5 rounded-xl bg-card pr-14 pl-11.5 text-[15px] shadow-sm" />
                <Kbd className="absolute top-1/2 right-3.5 -translate-y-1/2">⌘K</Kbd>
              </div>

              <div className="mb-8 grid grid-cols-2 gap-3.5 sm:grid-cols-4">
                {stats.map((s) => (
                  <Card key={s[0]} size="sm" className={cardCls}>
                    <CardContent className="px-4 py-0">
                      <div className="mb-1.5 text-xs text-muted-foreground">{s[0]}</div>
                      <div className="text-[25px] font-extrabold tracking-tight">{s[1]}</div>
                      <div className={cn("mt-1 text-[11.5px] font-medium", s[3])}>{s[2]}</div>
                    </CardContent>
                  </Card>
                ))}
              </div>

              <div className="grid gap-6 lg:grid-cols-[1.55fr_1fr]">
                <div>
                  <div className="mb-3 flex items-center justify-between">
                    <h2 className="text-[15px] font-bold">Zuletzt bearbeitet</h2>
                    <Button variant="link" size="sm" className="h-auto p-0" onClick={() => setView("spaces")}>Alle Spaces</Button>
                  </div>
                  <Card className={cn(cardCls, "overflow-hidden py-0")}>
                    {recent.map((r, i) => (
                      <button
                        type="button"
                        key={r[0]}
                        onClick={() => selectPage("erste-schritte")}
                        className={cn("flex w-full items-center gap-3 px-4 py-3 text-left hover:bg-muted/40", i < recent.length - 1 && "border-b border-border")}
                      >
                        <span className="flex size-7.5 shrink-0 items-center justify-center rounded-lg bg-muted text-muted-foreground">
                          <FileText className="size-4" />
                        </span>
                        <div className="min-w-0 flex-1">
                          <div className="truncate text-[13.5px] font-semibold">{r[0]}</div>
                          <div className="truncate text-xs text-muted-foreground">{r[1]}</div>
                        </div>
                        <Badge variant="secondary" className="rounded-md" style={{ color: r[3] }}>{r[2]}</Badge>
                      </button>
                    ))}
                  </Card>
                </div>
                <div>
                  <h2 className="mb-3 text-[15px] font-bold">Aktivität</h2>
                  <Card className={cn(cardCls, "px-4 py-1.5")}>
                    {activity.map((a) => (
                      <div key={`${a[0]}-${a[4]}`} className="flex gap-3 border-b border-border py-2.5 last:border-0">
                        <ColorAvatar initials={a[1]} color={a[2]} className="size-7" />
                        <div className="min-w-0 flex-1">
                          <div className="text-[13px] leading-snug">
                            <b className="font-bold">{a[0]}</b> {a[3]} <span className="font-semibold text-primary">{a[4]}</span>
                          </div>
                          <div className="mt-px text-[11.5px] text-muted-foreground">{a[5]}</div>
                        </div>
                      </div>
                    ))}
                  </Card>
                </div>
              </div>
            </div>
          )}

          {/* ===== READ ===== */}
          {view === "read" && (
            <div className="flex justify-center">
              <article className="min-w-0 max-w-[760px] flex-1 px-14 pt-11 pb-24">
                <div className="mb-3.5 flex items-center gap-2 text-[12.5px] text-muted-foreground">
                  <Badge className="gap-1.5 bg-primary/12 text-primary">
                    <span className="size-1.5 rounded-full bg-primary" />Onboarding
                  </Badge>
                  <span>·</span><span>4 Min. Lesezeit</span><span>·</span><span>14 Versionen</span>
                </div>
                <h1 className="mb-4 text-[38px] leading-[1.1] font-extrabold tracking-tight">Erste Schritte bei Nordwind</h1>
                <div className="mb-7.5 flex items-center gap-3 border-b border-border pb-5.5">
                  <ColorAvatar initials="SK" color="#7c3aed" className="size-6.5" />
                  <span className="text-[13px] text-muted-foreground">
                    Aktualisiert von <b className="font-semibold text-foreground">Sarah König</b> · heute, 09:24
                  </span>
                  <div className="flex-1" />
                  <AvatarGroup>
                    <ColorAvatar initials="LB" color="#1f6feb" className="size-6 text-[9.5px] ring-2 ring-card" />
                    <ColorAvatar initials="TM" color="#0f766e" className="size-6 text-[9.5px] ring-2 ring-card" />
                    <Avatar className="size-6 ring-2 ring-card">
                      <AvatarFallback className="bg-muted text-[9.5px] font-bold text-muted-foreground">+3</AvatarFallback>
                    </Avatar>
                  </AvatarGroup>
                </div>

                <Article />

                <div className="mt-10 flex items-center gap-2.5 border-t border-border pt-5.5">
                  <span className="text-[13px] text-muted-foreground">War das hilfreich?</span>
                  <Button variant="outline" size="sm" className="rounded-full hover:border-emerald-500 hover:text-emerald-600"><ThumbsUp /> 18</Button>
                  <Button variant="outline" size="sm" className="rounded-full"><ThumbsDown /> 1</Button>
                </div>
              </article>

              {/* TOC */}
              <aside className="sticky top-0 hidden h-svh w-[228px] shrink-0 self-start pt-12.5 pr-6 xl:block">
                <div className="mb-3 text-[11px] font-bold tracking-wider text-muted-foreground uppercase">Auf dieser Seite</div>
                <div className="flex flex-col gap-px border-l-2 border-border">
                  {toc.map(([label, id], i) => (
                    <a
                      key={id}
                      href={`#${id}`}
                      className={cn(
                        "-ml-0.5 border-l-2 py-1.5 pl-3.5 text-[13px] hover:text-foreground",
                        i === 0 ? "border-primary font-semibold text-primary" : "border-transparent text-muted-foreground",
                      )}
                    >
                      {label}
                    </a>
                  ))}
                </div>
                <div className="mt-5.5 flex flex-col gap-2.5 border-t border-border pt-4.5 text-[12.5px]">
                  <button type="button" onClick={() => { setHistTab("versions"); setView("history"); }} className="flex items-center gap-2 text-muted-foreground hover:text-primary">
                    <History className="size-3.5" /> Versionsverlauf
                  </button>
                  <button type="button" onClick={() => { setHistTab("comments"); setView("history"); }} className="flex items-center gap-2 text-muted-foreground hover:text-primary">
                    <MessageSquare className="size-3.5" /> 3 Kommentare
                  </button>
                  <button type="button" className="flex items-center gap-2 text-muted-foreground hover:text-primary">
                    <Share2 className="size-3.5" /> Teilen / Export
                  </button>
                </div>
              </aside>
            </div>
          )}

          {/* ===== EDITOR ===== */}
          {view === "edit" && (
            <div>
              <div className="sticky top-0 z-20 flex justify-center border-b border-border bg-card py-1.5">
                <div className="flex w-full max-w-[760px] flex-wrap items-center gap-0.5 px-6">
                  <Button variant="outline" size="icon-sm" title="Block einfügen" className="mr-1" onClick={() => setShowSlash((s) => !s)}>
                    <Plus />
                  </Button>
                  {tools.map((t, i) =>
                    "divider" in t ? (
                      <Separator key={`d${i}`} orientation="vertical" className="mx-1 h-5" />
                    ) : (
                      <Button key={t.label} variant="ghost" size="icon-sm" title={t.label} onClick={t.run}>
                        <t.icon />
                      </Button>
                    ),
                  )}
                </div>
              </div>

              <div className="relative mx-auto max-w-[760px] px-6 pt-9 pb-32">
                <div contentEditable suppressContentEditableWarning data-ph="Titel der Seite" className="mb-4.5 text-[38px] leading-[1.1] font-extrabold tracking-tight outline-none">
                  Erste Schritte bei Nordwind
                </div>
                <div
                  ref={editorRef}
                  contentEditable
                  suppressContentEditableWarning
                  className="min-h-[300px] font-serif text-[18px] leading-[1.72] outline-none [&_h2]:mt-7 [&_h2]:mb-3 [&_h2]:font-sans [&_h2]:text-2xl [&_h2]:font-bold [&_p]:mb-5 [&_ul]:mb-5 [&_ul]:list-disc [&_ul]:pl-6"
                >
                  <p className="text-muted-foreground">Schön, dass du da bist! Diese Seite führt dich durch deine ersten Tage bei Nordwind.</p>
                  <h2>Überblick</h2>
                  <p>Dein Onboarding gliedert sich in drei Phasen. Der Fokus liegt zunächst auf Orientierung und Setup.</p>
                  <ul>
                    <li>Daten im People-Portal bestätigen</li>
                    <li>Profilbild hochladen</li>
                    <li>Leitbild &amp; Werte lesen</li>
                  </ul>
                  <p>Probier die Toolbar oben aus — markiere Text und formatiere ihn, oder klick auf <b>+</b> für Blöcke.</p>
                </div>

                {showSlash && (
                  <div className="animate-in fade-in zoom-in-95 absolute top-32 left-6 z-30 w-[300px] rounded-xl border border-border bg-popover p-1.5 shadow-lg">
                    <div className="px-2.5 pt-1.5 pb-1 text-[10.5px] font-bold tracking-wider text-muted-foreground uppercase">Basis-Blöcke</div>
                    {slashItems.map(([Icon, label, desc, run]) => (
                      <button type="button" key={label} onClick={run} className="flex w-full items-center gap-3 rounded-lg px-2.5 py-2 text-left hover:bg-primary/10">
                        <span className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-muted text-muted-foreground">
                          <Icon className="size-4" />
                        </span>
                        <div>
                          <div className="text-[13px] font-semibold">{label}</div>
                          <div className="text-[11.5px] text-muted-foreground">{desc}</div>
                        </div>
                      </button>
                    ))}
                  </div>
                )}
              </div>
            </div>
          )}

          {/* ===== PERMISSIONS ===== */}
          {view === "permissions" && (
            <div className="mx-auto max-w-[1080px] px-10 pt-9 pb-20">
              <div className="mb-2 flex items-start gap-3.5">
                <div className="flex size-10.5 shrink-0 items-center justify-center rounded-xl bg-linear-to-br from-primary to-blue-800 text-[17px] font-extrabold text-white">TH</div>
                <div className="flex-1">
                  <h1 className="text-2xl font-extrabold tracking-tight">Team-Handbuch · Zugriff</h1>
                  <p className="mt-0.5 text-sm text-muted-foreground">Verwalte Mitglieder, Rollen und seitengenaue Berechtigungen für diesen Space.</p>
                </div>
              </div>

              <Tabs value={permTab} onValueChange={setPermTab} className="mt-5.5">
                <TabsList variant="line" className="mb-6 w-full justify-start border-b border-border">
                  <TabsTrigger value="members">Mitglieder <Badge variant="secondary" className="ml-1">6</Badge></TabsTrigger>
                  <TabsTrigger value="roles">Rollen & Rechte</TabsTrigger>
                  <TabsTrigger value="pages">Seiten-Berechtigungen</TabsTrigger>
                  <TabsTrigger value="invites">Einladungen <Badge variant="secondary" className="ml-1">3</Badge></TabsTrigger>
                </TabsList>
              </Tabs>

              {/* members */}
              {permTab === "members" && (
                <>
                  <div className="mb-4 flex items-center gap-2.5">
                    <div className="relative max-w-[320px] flex-1">
                      <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground" />
                      <Input placeholder="Mitglieder filtern …" className="h-9.5 pl-9" />
                    </div>
                    <div className="flex-1" />
                    <Button variant="outline" size="sm">Gruppen verwalten</Button>
                    <Button size="sm" onClick={() => setPermTab("invites")}><UserPlus /> Mitglied einladen</Button>
                  </div>
                  <Card className={cn(cardCls, "overflow-hidden py-0")}>
                    <Table>
                      <TableHeader>
                        <TableRow className="bg-muted/40 hover:bg-muted/40">
                          <TableHead className="text-[11.5px] tracking-wide uppercase">Name</TableHead>
                          <TableHead className="text-[11.5px] tracking-wide uppercase">Gruppe</TableHead>
                          <TableHead className="text-[11.5px] tracking-wide uppercase">Rolle</TableHead>
                          <TableHead className="text-[11.5px] tracking-wide uppercase">Status</TableHead>
                          <TableHead className="w-10" />
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {members.map((m) => (
                          <TableRow key={m[1]}>
                            <TableCell>
                              <div className="flex items-center gap-2.5">
                                <ColorAvatar initials={m[5]} color={m[6]} />
                                <div className="min-w-0">
                                  <div className="truncate text-[13.5px] font-semibold">{m[0]}</div>
                                  <div className="truncate text-xs text-muted-foreground">{m[1]}</div>
                                </div>
                              </div>
                            </TableCell>
                            <TableCell className="text-[13px] text-muted-foreground">{m[2]}</TableCell>
                            <TableCell><RoleBadge role={m[3]} /></TableCell>
                            <TableCell><span className={cn("text-xs font-semibold", STATUS_CLASS[m[4]])}>{m[4]}</span></TableCell>
                            <TableCell>
                              <Button variant="ghost" size="icon-sm"><MoreVertical /></Button>
                            </TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  </Card>
                </>
              )}

              {/* roles */}
              {permTab === "roles" && (
                <>
                  <div className="mb-6 grid grid-cols-2 gap-3 lg:grid-cols-4">
                    {roles.map((r) => (
                      <Card key={r[0]} size="sm" className={cardCls}>
                        <CardContent className="px-4 py-0">
                          <div className="mb-1.5 flex items-center gap-2">
                            <span className={cn("size-2.5 rounded-full", r[3])} />
                            <span className="text-sm font-bold">{r[0]}</span>
                          </div>
                          <div className="min-h-13.5 text-[12.5px] leading-normal text-muted-foreground">{r[1]}</div>
                          <div className="mt-2 border-t border-border pt-2.5 text-xs text-muted-foreground">{r[2]} Mitglieder</div>
                        </CardContent>
                      </Card>
                    ))}
                  </div>
                  <h2 className="mb-3 text-[15px] font-bold">Berechtigungs-Matrix</h2>
                  <Card className={cn(cardCls, "overflow-hidden py-0")}>
                    <Table>
                      <TableHeader>
                        <TableRow className="bg-muted/40 hover:bg-muted/40">
                          <TableHead className="w-[40%] text-xs">Berechtigung</TableHead>
                          {["Admin", "Editor", "Kommentator", "Leser"].map((h) => (
                            <TableHead key={h} className="text-center text-xs">{h}</TableHead>
                          ))}
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {matrix.map((row) => (
                          <TableRow key={row[0]}>
                            <TableCell className="text-[13.5px]">{row[0]}</TableCell>
                            {row[1].map((on, ci) => (
                              <TableCell key={`${row[0]}-${ci}`} className="text-center">
                                {on ? <Check className="mx-auto size-4 text-emerald-600 dark:text-emerald-400" /> : <Minus className="mx-auto size-4 text-muted-foreground/50" />}
                              </TableCell>
                            ))}
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  </Card>
                </>
              )}

              {/* page-level */}
              {permTab === "pages" && (
                <>
                  <p className="mb-4.5 max-w-[640px] text-[13.5px] text-muted-foreground">
                    Berechtigungen werden vom Space nach unten vererbt. Du kannst sie auf einzelnen Seiten überschreiben – untergeordnete Seiten erben dann die neue Einstellung.
                  </p>
                  <Card className={cn(cardCls, "overflow-hidden py-0")}>
                    {pagePerms.map((p, idx) => {
                      const isRoot = p[2] === "root";
                      const Icon = isRoot ? LayoutGrid : p[0] === 1 ? Folder : FileText;
                      return (
                        <div key={`${p[1]}-${idx}`} className="flex items-center justify-between gap-3 border-b border-border px-4 py-3 last:border-0 hover:bg-muted/40">
                          <div className="flex min-w-0 flex-1 items-center gap-2.5">
                            <span style={{ width: `${p[0] * 18}px` }} className="shrink-0" />
                            <Icon className="size-4 shrink-0 text-muted-foreground" />
                            <span className={cn("truncate text-[13.5px]", isRoot ? "font-bold" : "font-medium")}>{p[1]}</span>
                            <Badge variant="secondary" className={cn("rounded-md", pageBadge[p[2]])}>{pageBadgeText[p[2]]}</Badge>
                          </div>
                          <div className="flex shrink-0 items-center gap-2">
                            <span className="text-[12.5px] text-muted-foreground">{p[3]}</span>
                            <Button variant="outline" size="xs">{p[4]}</Button>
                          </div>
                        </div>
                      );
                    })}
                  </Card>
                </>
              )}

              {/* invites */}
              {permTab === "invites" && (
                <div className="grid items-start gap-6 lg:grid-cols-[1fr_320px]">
                  <div>
                    <h2 className="mb-3 text-[15px] font-bold">Offene Einladungen</h2>
                    <Card className={cn(cardCls, "overflow-hidden py-0")}>
                      {invites.map((iv) => (
                        <div key={iv[0]} className="flex items-center gap-3 border-b border-border px-4 py-3 last:border-0">
                          <span className="flex size-8.5 shrink-0 items-center justify-center rounded-full bg-muted text-muted-foreground">
                            <Mail className="size-4" />
                          </span>
                          <div className="min-w-0 flex-1">
                            <div className="text-[13.5px] font-semibold">{iv[0]}</div>
                            <div className="text-xs text-muted-foreground">Eingeladen von {iv[1]} · {iv[2]}</div>
                          </div>
                          <RoleBadge role={iv[3]} />
                          <Badge className="bg-amber-500/12 text-amber-600 dark:text-amber-300">Ausstehend</Badge>
                          <Button variant="ghost" size="sm" className="text-muted-foreground hover:text-destructive">Zurückziehen</Button>
                        </div>
                      ))}
                    </Card>
                  </div>
                  <Card className={cn(cardCls, "p-4.5")}>
                    <h3 className="mb-3.5 text-sm font-bold">Neue Einladung</h3>
                    <Label className="mb-1.5 text-xs">E-Mail-Adressen</Label>
                    <Input placeholder="name@firma.de, …" className="mb-3.5 bg-muted/40" />
                    <Label className="mb-1.5 text-xs">Rolle</Label>
                    <NativeSelect className="mb-3.5 bg-muted/40">
                      <NativeSelectOption>Editor</NativeSelectOption>
                      <NativeSelectOption>Kommentator</NativeSelectOption>
                      <NativeSelectOption>Leser</NativeSelectOption>
                      <NativeSelectOption>Administrator</NativeSelectOption>
                    </NativeSelect>
                    <Button className="w-full">Einladung senden</Button>
                  </Card>
                </div>
              )}
            </div>
          )}

          {/* ===== HISTORY ===== */}
          {view === "history" && (
            <div className="mx-auto max-w-[1000px] px-10 pt-9 pb-20">
              <div className="mb-1 text-[13px] text-muted-foreground">Erste Schritte bei Nordwind</div>
              <h1 className="mb-5.5 text-2xl font-extrabold tracking-tight">Verlauf &amp; Kommentare</h1>
              <Tabs value={histTab} onValueChange={setHistTab}>
                <TabsList variant="line" className="mb-6 w-full justify-start border-b border-border">
                  <TabsTrigger value="versions">Versionen <Badge variant="secondary" className="ml-1">14</Badge></TabsTrigger>
                  <TabsTrigger value="comments">Kommentare <Badge variant="secondary" className="ml-1">3</Badge></TabsTrigger>
                </TabsList>
              </Tabs>

              {histTab === "versions" && (
                <div className="relative pl-2">
                  {versions.map((v, i) => (
                    <div key={v[0]} className="relative flex gap-4 pb-1.5">
                      <div className="flex shrink-0 flex-col items-center">
                        <span className={cn("mt-4 size-3 shrink-0 rounded-full border-2", v[8] ? "border-primary bg-primary" : "border-border bg-card")} />
                        {i < versions.length - 1 && <span className="my-0.5 w-0.5 flex-1 bg-border" />}
                      </div>
                      <Card className={cn(cardCls, "mb-3.5 flex-1 px-4 py-3.5", v[8] && "border-primary/40")}>
                        <div className="mb-1.5 flex items-center gap-2.5">
                          <ColorAvatar initials={v[2]} color={v[3]} className="size-7" />
                          <div className="flex-1">
                            <span className="text-[13.5px] font-semibold">{v[1]}</span>
                            <span className="text-[12.5px] text-muted-foreground"> · {v[4]}</span>
                          </div>
                          {v[8] && <Badge className="bg-emerald-500/12 text-emerald-600 dark:text-emerald-400">Aktuell</Badge>}
                          <Kbd>{v[0]}</Kbd>
                        </div>
                        <div className="mb-2.5 text-[13.5px] text-muted-foreground">{v[5]}</div>
                        <div className="flex items-center gap-3.5">
                          <span className="font-mono text-xs text-emerald-600 dark:text-emerald-400">+{v[6]}</span>
                          <span className="font-mono text-xs text-destructive">−{v[7]}</span>
                          <div className="flex-1" />
                          <Button variant="outline" size="xs">Vergleichen</Button>
                          {v[9] && <Button variant="outline" size="xs" className="text-primary">Wiederherstellen</Button>}
                        </div>
                      </Card>
                    </div>
                  ))}
                </div>
              )}

              {histTab === "comments" && (
                <div className="flex max-w-[680px] flex-col gap-3.5">
                  {comments.map((c, i) => {
                    const isResolved = resolved[i];
                    return (
                      <Card key={c[4]} className={cn(cardCls, "p-4", isResolved && "opacity-70")}>
                        <div className="mb-2.5 flex items-center gap-2.5">
                          <ColorAvatar initials={c[1]} color={c[2]} className="size-7" />
                          <div className="flex-1">
                            <span className="text-[13.5px] font-semibold">{c[0]}</span>
                            <span className="text-[12.5px] text-muted-foreground"> · {c[3]}</span>
                          </div>
                          {isResolved && (
                            <span className="inline-flex items-center gap-1 text-[11.5px] font-semibold text-emerald-600 dark:text-emerald-400">
                              <Check className="size-3.5" />Gelöst
                            </span>
                          )}
                        </div>
                        <Badge variant="secondary" className="mb-2 rounded-md bg-primary/10 text-primary">Bezieht sich auf {c[4]}</Badge>
                        <div className="text-sm leading-relaxed">{c[5]}</div>
                        <div className="mt-2.5 flex items-center gap-3.5">
                          <Button variant="link" size="sm" className="h-auto p-0 text-muted-foreground">Antworten</Button>
                          {c[6] > 0 && <span className="text-[12.5px] text-muted-foreground">{c[6]} Antwort</span>}
                          <div className="flex-1" />
                          {!isResolved && (
                            <Button variant="outline" size="xs" onClick={() => setResolved((s) => ({ ...s, [i]: true }))} className="hover:border-emerald-500 hover:text-emerald-600">
                              Als gelöst markieren
                            </Button>
                          )}
                        </div>
                      </Card>
                    );
                  })}
                </div>
              )}
            </div>
          )}

          {/* ===== SPACES ===== */}
          {view === "spaces" && (
            <div className="mx-auto max-w-[1080px] px-10 pt-9 pb-20">
              <div className="mb-6 flex items-end justify-between">
                <div>
                  <h1 className="text-[28px] font-extrabold tracking-tight">Spaces</h1>
                  <p className="mt-1 text-sm text-muted-foreground">6 Bereiche · dein Zugriff wird pro Space verwaltet.</p>
                </div>
                <Button size="sm"><Plus /> Neuer Space</Button>
              </div>
              <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
                {spaces.map((s) => (
                  <Card
                    key={s[0]}
                    onClick={() => selectPage("erste-schritte")}
                    className={cn(cardCls, "cursor-pointer p-4.5 text-left transition-all hover:-translate-y-0.5 hover:shadow-md")}
                  >
                    <div className="mb-3 flex items-center justify-between">
                      <div className="flex size-10 items-center justify-center rounded-xl text-[15px] font-extrabold text-white" style={{ backgroundColor: s[2] }}>{s[1]}</div>
                      <RoleBadge role={s[6]} />
                    </div>
                    <div className="mb-1.5 text-base font-bold">{s[0]}</div>
                    <div className="min-h-10 text-[13px] leading-normal text-muted-foreground">{s[3]}</div>
                    <div className="mt-3.5 flex items-center gap-3.5 border-t border-border pt-3 text-xs text-muted-foreground">
                      <span className="flex items-center gap-1.5"><BookOpen className="size-3.5" />{s[4]}</span>
                      <span className="flex items-center gap-1.5"><Users className="size-3.5" />{s[5]}</span>
                      <div className="flex-1" />
                      <span>{s[7]}</span>
                    </div>
                  </Card>
                ))}
              </div>
            </div>
          )}
        </main>
      </SidebarInset>
    </SidebarProvider>
  );
}
