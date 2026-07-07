import { createFileRoute } from "@tanstack/react-router";
import { cn } from "@nilovon-wiki/ui/lib/utils";
import {
  Avatar,
  AvatarFallback,
  AvatarGroup,
  AvatarGroupCount,
} from "@nilovon-wiki/ui/components/avatar";
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
import { NativeSelect, NativeSelectOption } from "@nilovon-wiki/ui/components/native-select";
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
  BookOpen,
  Bold,
  Check,
  ChevronRight,
  ChevronsUpDown,
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
import { type ComponentType, useEffect, useRef, useState } from "react";

export const Route = createFileRoute("/_auth/")({
  component: RouteComponent,
});

/* ---------- shared bits ----------
 * Soft, rounded, blue. Components carry their own radii (Card, Badge, Avatar …);
 * we don't override them — we only compose. Cohesive cool avatar palette. */

const eyebrow = "text-[11px] font-semibold uppercase tracking-[0.08em] text-muted-foreground";

const ROLE_BADGE: Record<string, "default" | "secondary" | "outline" | "ghost"> = {
  Administrator: "default",
  Admin: "default",
  Editor: "secondary",
  Kommentator: "outline",
  Leser: "ghost",
};
function RoleBadge({ role, className }: { role: string; className?: string }) {
  return (
    <Badge variant={ROLE_BADGE[role] ?? "outline"} className={className}>
      {role}
    </Badge>
  );
}

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

const STATUS: Record<string, { dot: string; text: string }> = {
  Aktiv: { dot: "bg-emerald-500", text: "text-emerald-600 dark:text-emerald-400" },
  Eingeladen: { dot: "bg-amber-500", text: "text-amber-600 dark:text-amber-400" },
  Abwesend: { dot: "bg-muted-foreground/40", text: "text-muted-foreground" },
};
function StatusPill({ status }: { status: string }) {
  const s = STATUS[status] ?? STATUS.Abwesend;
  return (
    <span className={cn("inline-flex items-center gap-1.5 text-xs font-medium", s.text)}>
      <span className={cn("size-1.5 rounded-full", s.dot)} />
      {status}
    </span>
  );
}

/* ---------- article (read view) ---------- */

function ChecklistRow({ step, done }: { step: string; done: boolean }) {
  return (
    <div className="flex items-center justify-between gap-4 border-b border-border px-4 py-3 last:border-0">
      <span className="text-[15px]">{step}</span>
      {done ? (
        <span className="inline-flex items-center gap-1.5 text-xs font-semibold text-emerald-600 dark:text-emerald-400">
          <span className="flex size-4 items-center justify-center rounded-full bg-emerald-500/15">
            <Check className="size-3" />
          </span>
          Erledigt
        </span>
      ) : (
        <span className="inline-flex items-center gap-1.5 text-xs font-semibold text-muted-foreground">
          <span className="size-4 rounded-full border border-border" />
          Offen
        </span>
      )}
    </div>
  );
}

function Article() {
  const h2 =
    "mt-10 mb-4 scroll-mt-20 font-sans text-[22px] font-semibold tracking-tight text-foreground";
  return (
    <div className="font-serif text-[18px] leading-[1.75] text-foreground">
      <p className="mb-6 text-[19px] leading-[1.7] text-muted-foreground">
        Schön, dass du da bist! Diese Seite führt dich durch deine ersten Tage bei Nordwind – von
        der Vorbereitung vor dem Start bis zur Einrichtung deiner Arbeitsumgebung. Plane dafür
        ungefähr eine Stunde ein.
      </p>

      <h2 id="ueberblick" className={h2}>
        Überblick
      </h2>
      <p className="mb-6">
        Dein Onboarding gliedert sich in drei Phasen. In den ersten Tagen liegt der Fokus auf
        Orientierung und Setup – fachliche Tiefe kommt später ganz von selbst. Bei Fragen ist dein{" "}
        <em>Buddy</em> die erste Anlaufstelle.
      </p>

      <div className="mb-7 flex gap-3 rounded-xl border border-primary/20 bg-primary/[0.06] p-4 font-sans text-[14.5px] leading-relaxed">
        <span className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-primary/12 text-primary">
          <Info className="size-4.5" />
        </span>
        <div>
          <b className="font-semibold text-foreground">Gut zu wissen:</b> Deinen Buddy findest du im{" "}
          <span className="font-semibold text-primary">Org-Chart</span>. Trag dich außerdem für die
          wöchentliche Onboarding-Runde ein.
        </div>
      </div>

      <h2 id="vorab" className={h2}>
        Vor dem ersten Tag
      </h2>
      <p className="mb-4">
        Idealerweise erledigst du diese Punkte schon im Vorfeld, damit am ersten Tag alles
        bereitsteht:
      </p>
      <ul className="mb-6 list-disc pl-6 marker:text-primary">
        <li className="mb-2">
          Bestätige deine Daten im <b className="font-semibold">People-Portal</b> (Adresse,
          Bankverbindung, Notfallkontakt).
        </li>
        <li className="mb-2">
          Lade ein Profilbild hoch – das hilft Kolleg:innen, dich zuzuordnen.
        </li>
        <li className="mb-2">
          Lies das{" "}
          <span className="font-semibold text-primary underline decoration-primary/30 underline-offset-2">
            Leitbild &amp; Werte
          </span>
          , damit du weißt, wofür wir stehen.
        </li>
      </ul>

      <h2 id="ersttag" className={h2}>
        Dein erster Tag
      </h2>
      <p className="mb-4">
        Um 9:30 Uhr holt dich dein Buddy am Empfang ab. Der Vormittag ist für Setup und Kennenlernen
        reserviert, am Nachmittag folgt eine kurze Tour durchs Büro.
      </p>
      <blockquote className="mb-6 rounded-r-xl border-l-[3px] border-primary bg-muted/40 py-3 pr-5 pl-5 text-[18px] leading-[1.6] text-muted-foreground italic">
        „Niemand erwartet, dass du in Woche eins produktiv bist. Erwarte es auch nicht von dir
        selbst.“
      </blockquote>

      <h2 id="it-setup" className={h2}>
        IT-Setup
      </h2>
      <p className="mb-4">
        Dein Laptop ist vorkonfiguriert. Melde dich mit deinen Zugangsdaten an und arbeite die
        folgende Checkliste ab:
      </p>
      <div className="mb-6 overflow-hidden rounded-xl border border-border font-sans">
        <ChecklistRow step="SSO / 2-Faktor aktivieren" done />
        <ChecklistRow step="VPN einrichten" done={false} />
        <ChecklistRow step="Slack & Kalender verbinden" done={false} />
      </div>
      <pre className="mb-6 overflow-auto rounded-xl border border-border bg-muted/50 p-4 font-mono text-[13px] leading-relaxed">
        <span className="text-muted-foreground"># VPN-Profil installieren</span>
        {"\n"}brew install nordwind-vpn{"\n"}nordwind-vpn login --sso
      </pre>

      <h2 id="kontakte" className={h2}>
        Wichtige Kontakte
      </h2>
      <p className="mb-3.5">Bei Problemen wendest du dich an:</p>
      <ul className="mb-2.5 list-disc pl-6 marker:text-primary">
        <li className="mb-2">
          <b className="font-semibold">IT-Support</b> —{" "}
          <span className="font-mono text-[15px] text-primary">#it-help</span> in Slack
        </li>
        <li className="mb-2">
          <b className="font-semibold">People &amp; Culture</b> — Sarah König
        </li>
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
    userName
      .split(" ")
      .map((w) => w[0])
      .slice(0, 2)
      .join("")
      .toUpperCase() || "SK";

  const [theme, setTheme] = useState<"light" | "dark">("dark");
  const [view, setView] = useState("dashboard");
  const [activePage, setActivePage] = useState("erste-schritte");
  const [permTab, setPermTab] = useState("members");
  const [histTab, setHistTab] = useState("versions");
  const [showSlash, setShowSlash] = useState(false);
  const [resolved, setResolved] = useState<Record<number, boolean>>({
    0: false,
    1: true,
    2: false,
  });

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

  const now = new Date();
  const dateLine = now.toLocaleDateString("de-DE", {
    weekday: "long",
    day: "numeric",
    month: "long",
  });
  const greeting =
    now.getHours() < 11 ? "Guten Morgen" : now.getHours() < 18 ? "Guten Tag" : "Guten Abend";

  /* ----- data ----- */
  const nav: [string, string, ComponentType<{ className?: string }>][] = [
    ["dashboard", "Übersicht", Home],
    ["spaces", "Alle Spaces", LayoutGrid],
    ["permissions", "Mitglieder & Rechte", Lock],
  ];
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

  const crumbMap: Record<string, string[]> = {
    dashboard: ["Übersicht"],
    spaces: ["Spaces"],
    read: ["Team-Handbuch", "Onboarding", "Erste Schritte bei Nordwind"],
    edit: ["Team-Handbuch", "Erste Schritte bei Nordwind", "Bearbeiten"],
    permissions: ["Team-Handbuch", "Zugriff"],
    history: ["Team-Handbuch", "Erste Schritte", "Verlauf"],
  };
  const crumbs = crumbMap[view] || ["Übersicht"];

  const stats: [string, string, string][] = [
    ["Seiten", "48", "+3 diese Woche"],
    ["Mitglieder", "24", "6 aktiv jetzt"],
    ["Offene Kommentare", "3", "2 dir zugewiesen"],
  ];
  const recent: [string, string, string, string][] = [
    ["Erste Schritte bei Nordwind", "Sarah König · vor 2 Std.", "Team-Handbuch", "#8b5cf6"],
    ["Incident-Runbook: API-Gateway", "Tobias Mayer · vor 4 Std.", "Engineering", "#14b8a6"],
    ["Q3 Roadmap-Entwurf", "Du · vor 5 Std.", "Produkt", "#6366f1"],
    ["Benefits & Vergünstigungen", "Lena Brandt · gestern", "People", "#0ea5e9"],
    ["Marken-Richtlinien 2026", "David Klein · gestern", "Design", "#3b82f6"],
  ];
  const activity: [string, string, string, string, string, string][] = [
    ["Tobias Mayer", "TM", "#14b8a6", "kommentierte", "IT-Setup", "vor 2 Std."],
    ["Lena Brandt", "LB", "#6366f1", "bearbeitete", "Benefits", "vor 4 Std."],
    ["Sarah König", "SK", "#8b5cf6", "erstellte", "VPN-Anleitung", "vor 5 Std."],
    ["David Klein", "DK", "#3b82f6", "verschob", "Logo-Assets", "gestern"],
    ["Jonas Weber", "JW", "#0ea5e9", "lud ein", "m.olsen@partner.io", "gestern"],
  ];
  const members: [string, string, string, string, string, string, string][] = [
    [
      "Lena Brandt",
      "lena.brandt@nordwind.de",
      "Leitung",
      "Administrator",
      "Aktiv",
      "LB",
      "#6366f1",
    ],
    ["Tobias Mayer", "tobias.mayer@nordwind.de", "Engineering", "Editor", "Aktiv", "TM", "#14b8a6"],
    [
      "Sarah König",
      "sarah.koenig@nordwind.de",
      "People & Culture",
      "Editor",
      "Aktiv",
      "SK",
      "#8b5cf6",
    ],
    [
      "Jonas Weber",
      "jonas.weber@nordwind.de",
      "Engineering",
      "Kommentator",
      "Aktiv",
      "JW",
      "#0ea5e9",
    ],
    ["David Klein", "david.klein@nordwind.de", "Design", "Editor", "Abwesend", "DK", "#3b82f6"],
    ["Mara Olsen", "m.olsen@partner.io", "Extern", "Leser", "Eingeladen", "MO", "#0891b2"],
  ];
  const roles: [string, string, string, string][] = [
    [
      "Administrator",
      "Voller Zugriff inkl. Berechtigungen und Space-Einstellungen.",
      "1",
      "bg-primary",
    ],
    ["Editor", "Seiten erstellen, bearbeiten, verschieben und löschen.", "3", "bg-sky-500"],
    ["Kommentator", "Lesen und kommentieren, aber keine Bearbeitung.", "1", "bg-teal-500"],
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
  const pageBadge: Record<string, "default" | "secondary" | "outline" | "destructive"> = {
    root: "default",
    inherit: "secondary",
    override: "outline",
    restricted: "destructive",
  };
  const pageBadgeText: Record<string, string> = {
    root: "Space-Standard",
    inherit: "Geerbt",
    override: "Überschrieben",
    restricted: "Eingeschränkt",
  };
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
  const versions: [
    string,
    string,
    string,
    string,
    string,
    string,
    number,
    number,
    boolean,
    boolean,
  ][] = [
    [
      "v14",
      "Sarah König",
      "SK",
      "#8b5cf6",
      "heute, 09:24",
      "Abschnitt „IT-Setup“ um VPN-Schritte ergänzt",
      42,
      6,
      true,
      false,
    ],
    [
      "v13",
      "Tobias Mayer",
      "TM",
      "#14b8a6",
      "gestern, 16:10",
      "Tippfehler korrigiert, Slack-Links aktualisiert",
      8,
      8,
      false,
      true,
    ],
    [
      "v12",
      "Sarah König",
      "SK",
      "#8b5cf6",
      "24. Juni, 11:02",
      "Checkliste neu strukturiert (Tabelle eingefügt)",
      60,
      14,
      false,
      true,
    ],
    [
      "v11",
      "Lena Brandt",
      "LB",
      "#6366f1",
      "21. Juni, 08:45",
      "Seite angelegt",
      120,
      0,
      false,
      true,
    ],
  ];
  const comments: [string, string, string, string, string, string, number][] = [
    [
      "Tobias Mayer",
      "TM",
      "#14b8a6",
      "vor 2 Std.",
      "IT-Setup",
      "Sollten wir hier nicht auch erwähnen, dass der VPN-Zugang erst nach SSO-Freischaltung funktioniert? Das hat letzte Woche für Verwirrung gesorgt.",
      0,
    ],
    [
      "Lena Brandt",
      "LB",
      "#6366f1",
      "gestern",
      "Erste Schritte",
      "Super überarbeitet, danke! Die neue Checkliste ist viel klarer. 👍",
      1,
    ],
    [
      "Jonas Weber",
      "JW",
      "#0ea5e9",
      "vor 3 Tagen",
      "Wichtige Kontakte",
      "Können wir noch den Notfall-Kontakt für Hardware-Ausfälle ergänzen?",
      2,
    ],
  ];
  const spaces: [string, string, string, string, string, string, string, string][] = [
    [
      "Team-Handbuch",
      "TH",
      "#6366f1",
      "Onboarding, Prozesse und alles Wissenswerte fürs Team.",
      "48",
      "24",
      "Editor",
      "vor 2 Std.",
    ],
    [
      "Engineering",
      "EN",
      "#14b8a6",
      "Architektur, Runbooks und technische Entscheidungen.",
      "132",
      "18",
      "Administrator",
      "vor 1 Tag",
    ],
    [
      "Produkt",
      "PR",
      "#8b5cf6",
      "Roadmap, Specs und Nutzer-Research.",
      "76",
      "15",
      "Kommentator",
      "vor 3 Std.",
    ],
    [
      "People & Culture",
      "PC",
      "#0ea5e9",
      "Policies, Benefits und Recruiting-Prozesse.",
      "54",
      "9",
      "Leser",
      "vor 5 Tagen",
    ],
    [
      "Sales & Marketing",
      "SM",
      "#0891b2",
      "Playbooks, Pitch-Material und Kampagnen.",
      "39",
      "12",
      "Editor",
      "vor 1 Woche",
    ],
    [
      "Design",
      "DS",
      "#3b82f6",
      "Guidelines, Komponenten und Marken-Assets.",
      "61",
      "7",
      "Editor",
      "vor 4 Std.",
    ],
  ];
  const toc: [string, string][] = [
    ["Überblick", "ueberblick"],
    ["Vor dem ersten Tag", "vorab"],
    ["Dein erster Tag", "ersttag"],
    ["IT-Setup", "it-setup"],
    ["Wichtige Kontakte", "kontakte"],
  ];

  const tools: (
    | { divider: true }
    | { icon: ComponentType<{ className?: string }>; label: string; run: () => void }
  )[] = [
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
    {
      icon: LinkIcon,
      label: "Link einfügen",
      run: () => exec("createLink", "https://wiki.nordwind.de"),
    },
  ];
  const slashItems: [ComponentType<{ className?: string }>, string, string, () => void][] = [
    [
      Heading2,
      "Überschrift",
      "Große Abschnitts-Überschrift",
      () => {
        setShowSlash(false);
        exec("formatBlock", "H2");
      },
    ],
    [
      Pilcrow,
      "Text",
      "Einfacher Absatz",
      () => {
        setShowSlash(false);
        exec("formatBlock", "P");
      },
    ],
    [
      List,
      "Aufzählung",
      "Liste mit Punkten",
      () => {
        setShowSlash(false);
        exec("insertUnorderedList");
      },
    ],
    [
      Quote,
      "Zitat",
      "Hervorgehobenes Zitat",
      () => {
        setShowSlash(false);
        exec("formatBlock", "BLOCKQUOTE");
      },
    ],
    [
      Code,
      "Code",
      "Code-Block",
      () => {
        setShowSlash(false);
        exec("formatBlock", "PRE");
      },
    ],
    [
      TableIcon,
      "Tabelle",
      "3×3-Raster einfügen",
      () => {
        setShowSlash(false);
        exec(
          "insertHTML",
          '<table style="border-collapse:collapse;width:100%;margin:8px 0"><tr><td style="border:1px solid var(--border);padding:8px">&nbsp;</td><td style="border:1px solid var(--border);padding:8px">&nbsp;</td></tr></table>',
        );
      },
    ],
  ];

  return (
    <SidebarProvider className="h-svh min-h-0">
      {/* ============ SIDEBAR ============ */}
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
              onClick={() => setView("dashboard")}
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
              {nav.map(([id, label, Icon]) => (
                <SidebarMenuItem key={id}>
                  <SidebarMenuButton
                    isActive={view === id}
                    onClick={() => setView(id)}
                    className="data-active:bg-primary/10 data-active:font-medium data-active:text-primary"
                  >
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
                          const active = activePage === pid && view === "read";
                          return (
                            <SidebarMenuSubItem key={pid}>
                              <SidebarMenuSubButton
                                isActive={active}
                                onClick={() => selectPage(pid)}
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
          <ColorAvatar initials={initials} color="#8b5cf6" size="sm" />
          <div className="min-w-0 flex-1">
            <div className="truncate text-[13px] leading-tight font-semibold">{userName}</div>
            <div className="flex items-center gap-1 text-[11px] text-muted-foreground">
              <span className="size-1.5 rounded-full bg-emerald-500" />
              Editor · Online
            </div>
          </div>
          <Button
            variant="ghost"
            size="icon-sm"
            title="Theme wechseln"
            onClick={() => setTheme((t) => (t === "light" ? "dark" : "light"))}
          >
            {theme === "light" ? <Sun /> : <Moon />}
          </Button>
        </SidebarFooter>
      </Sidebar>

      {/* ============ MAIN ============ */}
      <SidebarInset className="min-w-0">
        {/* topbar */}
        <header className="flex h-14 shrink-0 items-center gap-3.5 border-b border-border bg-background/80 px-5 backdrop-blur">
          <Breadcrumb className="min-w-0 flex-1">
            <BreadcrumbList>
              {crumbs.map((label, i) => {
                const last = i === crumbs.length - 1;
                return (
                  <BreadcrumbItem key={label}>
                    {last ? (
                      <BreadcrumbPage className="font-semibold">{label}</BreadcrumbPage>
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
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => {
                    setHistTab("versions");
                    setView("history");
                  }}
                >
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
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => {
                    setShowSlash(false);
                    setView("read");
                  }}
                >
                  Abbrechen
                </Button>
                <Button
                  size="sm"
                  onClick={() => {
                    setShowSlash(false);
                    setView("read");
                  }}
                >
                  Veröffentlichen
                </Button>
              </>
            )}
            {view !== "edit" && (
              <Button
                variant="outline"
                size="icon-sm"
                title="Neue Seite"
                onClick={() => setView("edit")}
              >
                <Plus />
              </Button>
            )}
          </div>
        </header>

        {/* view region */}
        <main className="relative flex-1 overflow-y-auto">
          {/* ===== DASHBOARD ===== */}
          {view === "dashboard" && (
            <div className="mx-auto max-w-[1080px] px-8 pt-8 pb-20">
              {/* hero */}
              <Card className="mb-8 overflow-hidden rounded-2xl p-7">
                <div className="flex flex-wrap items-end justify-between gap-4">
                  <div>
                    <div className={cn(eyebrow, "mb-2 flex items-center gap-1.5 text-primary")}>
                      {dateLine}
                    </div>
                    <h1 className="text-[28px] leading-tight font-semibold tracking-tight">
                      {greeting}, {firstName}.
                    </h1>
                    <p className="mt-1 text-sm text-muted-foreground">
                      Du hast 2 neue Kommentare und 3 aktualisierte Seiten seit gestern.
                    </p>
                  </div>
                  <Button onClick={() => setView("edit")} className="shrink-0">
                    <Plus /> Neue Seite
                  </Button>
                </div>

                <div className="mt-6 grid grid-cols-3 gap-3">
                  {stats.map(([label, value, delta]) => (
                    <Card key={label} className="px-4 py-3">
                      <div className="text-[13px] text-muted-foreground">{label}</div>
                      <div className="text-2xl font-semibold tracking-tight">{value}</div>
                      <div className="text-[11.5px] text-muted-foreground">{delta}</div>
                    </Card>
                  ))}
                </div>
              </Card>

              <div className="grid gap-8 lg:grid-cols-[1fr_300px]">
                {/* recently edited */}
                <section>
                  <div className="mb-3 flex items-center justify-between">
                    <h2 className="text-[15px] font-semibold">Zuletzt bearbeitet</h2>
                    <button
                      type="button"
                      onClick={() => setView("spaces")}
                      className="text-[13px] font-medium text-primary transition-colors hover:text-primary/80"
                    >
                      Alle Spaces
                    </button>
                  </div>
                  <Card className="gap-0 py-0">
                    {recent.map((r) => (
                      <button
                        type="button"
                        key={r[0]}
                        onClick={() => selectPage("erste-schritte")}
                        className="group flex w-full items-center gap-3 border-b border-border px-4 py-3.5 text-left transition-colors last:border-0 hover:bg-muted/50"
                      >
                        <span
                          className="flex size-9 shrink-0 items-center justify-center rounded-lg text-white shadow-sm"
                          style={{ backgroundColor: r[3] }}
                        >
                          <FileText className="size-4.5" />
                        </span>
                        <div className="min-w-0 flex-1">
                          <div className="truncate text-[14px] font-medium group-hover:text-primary">
                            {r[0]}
                          </div>
                          <div className="mt-0.5 truncate text-xs text-muted-foreground">
                            {r[1]}
                          </div>
                        </div>
                        <Badge variant="outline" className="shrink-0">
                          {r[2]}
                        </Badge>
                      </button>
                    ))}
                  </Card>
                </section>

                {/* activity */}
                <aside>
                  <h2 className="mb-3 text-[15px] font-semibold">Aktivität</h2>
                  <Card className="gap-0 py-4">
                    <CardContent className="flex flex-col gap-4">
                      {activity.map((a) => (
                        <div key={`${a[0]}-${a[4]}`} className="flex gap-2.5">
                          <ColorAvatar initials={a[1]} color={a[2]} size="sm" className="mt-0.5" />
                          <div className="min-w-0 text-[13px] leading-snug">
                            <span className="font-medium">{a[0]}</span>{" "}
                            <span className="text-muted-foreground">{a[3]}</span>{" "}
                            <span className="font-medium text-primary">{a[4]}</span>
                            <div className="mt-0.5 text-xs text-muted-foreground">{a[5]}</div>
                          </div>
                        </div>
                      ))}
                    </CardContent>
                  </Card>
                </aside>
              </div>
            </div>
          )}

          {/* ===== READ ===== */}
          {view === "read" && (
            <div className="flex justify-center">
              <article className="min-w-0 max-w-[760px] flex-1 px-14 pt-11 pb-24">
                <div className="mb-4 flex items-center gap-2.5 text-[12.5px] text-muted-foreground">
                  <Badge className="bg-primary/12 text-primary">Onboarding</Badge>
                  <span>·</span>
                  <span>4 Min. Lesezeit</span>
                  <span>·</span>
                  <span>14 Versionen</span>
                </div>
                <h1 className="mb-4 font-serif text-[36px] leading-[1.12] font-semibold tracking-tight">
                  Erste Schritte bei Nordwind
                </h1>
                <div className="mb-8 flex items-center gap-3 border-b border-border pb-6">
                  <ColorAvatar initials="SK" color="#8b5cf6" size="sm" />
                  <span className="text-[13px] text-muted-foreground">
                    Aktualisiert von <b className="font-semibold text-foreground">Sarah König</b> ·
                    heute, 09:24
                  </span>
                  <div className="flex-1" />
                  <AvatarGroup>
                    <ColorAvatar initials="LB" color="#6366f1" size="sm" />
                    <ColorAvatar initials="TM" color="#14b8a6" size="sm" />
                    <AvatarGroupCount className="size-6 text-[10px]">+3</AvatarGroupCount>
                  </AvatarGroup>
                </div>

                <Article />

                <div className="mt-12 flex items-center gap-2.5 rounded-xl border border-border bg-muted/30 px-4 py-3">
                  <span className="text-[13px] font-medium">War das hilfreich?</span>
                  <div className="flex-1" />
                  <Button variant="outline" size="sm">
                    <ThumbsUp /> 18
                  </Button>
                  <Button variant="outline" size="sm">
                    <ThumbsDown /> 1
                  </Button>
                </div>
              </article>

              {/* TOC */}
              <aside className="sticky top-0 hidden h-svh w-[236px] shrink-0 self-start pt-12 pr-6 xl:block">
                <div className={cn(eyebrow, "mb-3")}>Auf dieser Seite</div>
                <div className="flex flex-col gap-px border-l border-border">
                  {toc.map(([label, id], i) => (
                    <a
                      key={id}
                      href={`#${id}`}
                      className={cn(
                        "-ml-px border-l-2 py-1.5 pl-3.5 text-[13px] transition-colors hover:text-foreground",
                        i === 0
                          ? "border-primary font-medium text-primary"
                          : "border-transparent text-muted-foreground",
                      )}
                    >
                      {label}
                    </a>
                  ))}
                </div>
                <div className="mt-6 flex flex-col gap-2.5 border-t border-border pt-5 text-[12.5px]">
                  <button
                    type="button"
                    onClick={() => {
                      setHistTab("versions");
                      setView("history");
                    }}
                    className="flex items-center gap-2 text-muted-foreground transition-colors hover:text-primary"
                  >
                    <History className="size-3.5" /> Versionsverlauf
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setHistTab("comments");
                      setView("history");
                    }}
                    className="flex items-center gap-2 text-muted-foreground transition-colors hover:text-primary"
                  >
                    <MessageSquare className="size-3.5" /> 3 Kommentare
                  </button>
                  <button
                    type="button"
                    className="flex items-center gap-2 text-muted-foreground transition-colors hover:text-primary"
                  >
                    <Share2 className="size-3.5" /> Teilen / Export
                  </button>
                </div>
              </aside>
            </div>
          )}

          {/* ===== EDITOR ===== */}
          {view === "edit" && (
            <div>
              <div className="sticky top-0 z-20 flex justify-center border-b border-border bg-background/90 py-2 backdrop-blur">
                <div className="flex w-full max-w-[760px] flex-wrap items-center gap-0.5 rounded-xl px-6">
                  <Button
                    variant="outline"
                    size="icon-sm"
                    title="Block einfügen"
                    className="mr-1"
                    onClick={() => setShowSlash((s) => !s)}
                  >
                    <Plus />
                  </Button>
                  {tools.map((t, i) =>
                    "divider" in t ? (
                      <Separator key={`d${i}`} orientation="vertical" className="mx-1 h-5" />
                    ) : (
                      <Button
                        key={t.label}
                        variant="ghost"
                        size="icon-sm"
                        title={t.label}
                        onClick={t.run}
                      >
                        <t.icon />
                      </Button>
                    ),
                  )}
                </div>
              </div>

              <div className="relative mx-auto max-w-[760px] px-6 pt-9 pb-32">
                <div
                  contentEditable
                  suppressContentEditableWarning
                  data-ph="Titel der Seite"
                  className="mb-5 font-serif text-[36px] leading-[1.12] font-semibold tracking-tight outline-none"
                >
                  Erste Schritte bei Nordwind
                </div>
                <div
                  ref={editorRef}
                  contentEditable
                  suppressContentEditableWarning
                  className="min-h-[300px] font-serif text-[18px] leading-[1.75] outline-none [&_h2]:mt-8 [&_h2]:mb-3 [&_h2]:font-sans [&_h2]:text-[22px] [&_h2]:font-semibold [&_h2]:tracking-tight [&_p]:mb-5 [&_ul]:mb-5 [&_ul]:list-disc [&_ul]:pl-6 [&_ul]:marker:text-primary"
                >
                  <p className="text-muted-foreground">
                    Schön, dass du da bist! Diese Seite führt dich durch deine ersten Tage bei
                    Nordwind.
                  </p>
                  <h2>Überblick</h2>
                  <p>
                    Dein Onboarding gliedert sich in drei Phasen. Der Fokus liegt zunächst auf
                    Orientierung und Setup.
                  </p>
                  <ul>
                    <li>Daten im People-Portal bestätigen</li>
                    <li>Profilbild hochladen</li>
                    <li>Leitbild &amp; Werte lesen</li>
                  </ul>
                  <p>
                    Probier die Toolbar oben aus — markiere Text und formatiere ihn, oder klick auf{" "}
                    <b>+</b> für Blöcke.
                  </p>
                </div>

                {showSlash && (
                  <div className="absolute top-32 left-6 z-30 w-[300px] rounded-xl border border-border bg-popover p-1.5 shadow-lg">
                    <div className={cn(eyebrow, "px-2.5 pt-1.5 pb-1")}>Basis-Blöcke</div>
                    {slashItems.map(([Icon, label, desc, run]) => (
                      <button
                        type="button"
                        key={label}
                        onClick={run}
                        className="flex w-full items-center gap-3 rounded-lg px-2.5 py-2 text-left transition-colors hover:bg-muted"
                      >
                        <span className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">
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
                <div className="flex size-11 shrink-0 items-center justify-center rounded-xl bg-primary text-[15px] font-bold text-primary-foreground shadow-sm">
                  TH
                </div>
                <div className="flex-1">
                  <h1 className="text-2xl font-semibold tracking-tight">Team-Handbuch · Zugriff</h1>
                  <p className="mt-0.5 text-sm text-muted-foreground">
                    Verwalte Mitglieder, Rollen und seitengenaue Berechtigungen für diesen Space.
                  </p>
                </div>
              </div>

              <Tabs value={permTab} onValueChange={setPermTab} className="mt-6">
                <TabsList
                  variant="line"
                  className="mb-6 w-full justify-start border-b border-border"
                >
                  <TabsTrigger value="members">
                    Mitglieder{" "}
                    <Badge variant="secondary" className="ml-1">
                      6
                    </Badge>
                  </TabsTrigger>
                  <TabsTrigger value="roles">Rollen &amp; Rechte</TabsTrigger>
                  <TabsTrigger value="pages">Seiten-Berechtigungen</TabsTrigger>
                  <TabsTrigger value="invites">
                    Einladungen{" "}
                    <Badge variant="secondary" className="ml-1">
                      3
                    </Badge>
                  </TabsTrigger>
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
                    <Button variant="outline" size="sm">
                      Gruppen verwalten
                    </Button>
                    <Button size="sm" onClick={() => setPermTab("invites")}>
                      <UserPlus /> Mitglied einladen
                    </Button>
                  </div>
                  <Card className="py-0">
                    <Table>
                      <TableHeader>
                        <TableRow className="hover:bg-transparent">
                          <TableHead className="pl-4 text-xs">Name</TableHead>
                          <TableHead className="text-xs">Gruppe</TableHead>
                          <TableHead className="text-xs">Rolle</TableHead>
                          <TableHead className="text-xs">Status</TableHead>
                          <TableHead className="w-10" />
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {members.map((m) => (
                          <TableRow key={m[1]}>
                            <TableCell className="py-3 pl-4">
                              <div className="flex items-center gap-2.5">
                                <ColorAvatar initials={m[5]} color={m[6]} size="sm" />
                                <div className="min-w-0">
                                  <div className="truncate text-[13.5px] font-semibold">{m[0]}</div>
                                  <div className="truncate text-xs text-muted-foreground">
                                    {m[1]}
                                  </div>
                                </div>
                              </div>
                            </TableCell>
                            <TableCell className="text-[13px] text-muted-foreground">
                              {m[2]}
                            </TableCell>
                            <TableCell>
                              <RoleBadge role={m[3]} />
                            </TableCell>
                            <TableCell>
                              <StatusPill status={m[4]} />
                            </TableCell>
                            <TableCell>
                              <Button variant="ghost" size="icon-sm">
                                <MoreVertical />
                              </Button>
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
                      <Card key={r[0]} size="sm">
                        <CardContent>
                          <div className="mb-1.5 flex items-center gap-2">
                            <span className={cn("size-2.5 rounded-full", r[3])} />
                            <span className="text-sm font-semibold">{r[0]}</span>
                          </div>
                          <div className="min-h-13.5 text-[12.5px] leading-normal text-muted-foreground">
                            {r[1]}
                          </div>
                          <div className="mt-2 border-t border-border pt-2.5 text-xs text-muted-foreground">
                            {r[2]} {r[2] === "1" ? "Mitglied" : "Mitglieder"}
                          </div>
                        </CardContent>
                      </Card>
                    ))}
                  </div>
                  <h2 className="mb-3 text-[15px] font-semibold">Berechtigungs-Matrix</h2>
                  <Card className="py-0">
                    <Table>
                      <TableHeader>
                        <TableRow className="hover:bg-transparent">
                          <TableHead className="w-[40%] pl-4 text-xs">Berechtigung</TableHead>
                          {["Admin", "Editor", "Kommentator", "Leser"].map((h) => (
                            <TableHead key={h} className="text-center text-xs">
                              {h}
                            </TableHead>
                          ))}
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {matrix.map((row) => (
                          <TableRow key={row[0]}>
                            <TableCell className="pl-4 text-[13.5px]">{row[0]}</TableCell>
                            {row[1].map((on, ci) => (
                              <TableCell key={`${row[0]}-${ci}`} className="text-center">
                                {on ? (
                                  <span className="mx-auto flex size-5 items-center justify-center rounded-full bg-primary/12 text-primary">
                                    <Check className="size-3.5" />
                                  </span>
                                ) : (
                                  <Minus className="mx-auto size-4 text-muted-foreground/40" />
                                )}
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
                    Berechtigungen werden vom Space nach unten vererbt. Du kannst sie auf einzelnen
                    Seiten überschreiben – untergeordnete Seiten erben dann die neue Einstellung.
                  </p>
                  <Card className="gap-0 py-0">
                    {pagePerms.map((p, idx) => {
                      const isRoot = p[2] === "root";
                      const Icon = isRoot ? LayoutGrid : p[0] === 1 ? Folder : FileText;
                      return (
                        <div
                          key={`${p[1]}-${idx}`}
                          className="flex items-center justify-between gap-3 border-b border-border px-4 py-3 transition-colors last:border-0 hover:bg-muted/40"
                        >
                          <div className="flex min-w-0 flex-1 items-center gap-2.5">
                            <span style={{ width: `${p[0] * 18}px` }} className="shrink-0" />
                            <Icon className="size-4 shrink-0 text-muted-foreground" />
                            <span
                              className={cn(
                                "truncate text-[13.5px]",
                                isRoot ? "font-semibold" : "font-medium",
                              )}
                            >
                              {p[1]}
                            </span>
                            <Badge variant={pageBadge[p[2]]}>{pageBadgeText[p[2]]}</Badge>
                          </div>
                          <div className="flex shrink-0 items-center gap-2">
                            <span className="text-[12.5px] text-muted-foreground">{p[3]}</span>
                            <Button variant="outline" size="xs">
                              {p[4]}
                            </Button>
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
                    <h2 className="mb-3 text-[15px] font-semibold">Offene Einladungen</h2>
                    <Card className="gap-0 py-0">
                      {invites.map((iv) => (
                        <div
                          key={iv[0]}
                          className="flex items-center gap-3 border-b border-border px-4 py-3 last:border-0"
                        >
                          <span className="flex size-9 shrink-0 items-center justify-center rounded-full bg-primary/10 text-primary">
                            <Mail className="size-4" />
                          </span>
                          <div className="min-w-0 flex-1">
                            <div className="text-[13.5px] font-semibold">{iv[0]}</div>
                            <div className="text-xs text-muted-foreground">
                              Eingeladen von {iv[1]} · {iv[2]}
                            </div>
                          </div>
                          <RoleBadge role={iv[3]} />
                          <Badge variant="outline" className="text-amber-600 dark:text-amber-400">
                            Ausstehend
                          </Badge>
                          <Button
                            variant="ghost"
                            size="sm"
                            className="text-muted-foreground hover:text-destructive"
                          >
                            Zurückziehen
                          </Button>
                        </div>
                      ))}
                    </Card>
                  </div>
                  <Card>
                    <CardContent>
                      <h3 className="mb-3.5 text-sm font-semibold">Neue Einladung</h3>
                      <Label className="mb-1.5 text-xs">E-Mail-Adressen</Label>
                      <Input placeholder="name@firma.de, …" className="mb-3.5" />
                      <Label className="mb-1.5 text-xs">Rolle</Label>
                      <NativeSelect className="mb-3.5">
                        <NativeSelectOption>Editor</NativeSelectOption>
                        <NativeSelectOption>Kommentator</NativeSelectOption>
                        <NativeSelectOption>Leser</NativeSelectOption>
                        <NativeSelectOption>Administrator</NativeSelectOption>
                      </NativeSelect>
                      <Button className="w-full">Einladung senden</Button>
                    </CardContent>
                  </Card>
                </div>
              )}
            </div>
          )}

          {/* ===== HISTORY ===== */}
          {view === "history" && (
            <div className="mx-auto max-w-[1000px] px-10 pt-9 pb-20">
              <div className="mb-1 text-[13px] text-muted-foreground">
                Erste Schritte bei Nordwind
              </div>
              <h1 className="mb-5 text-2xl font-semibold tracking-tight">
                Verlauf &amp; Kommentare
              </h1>
              <Tabs value={histTab} onValueChange={setHistTab}>
                <TabsList
                  variant="line"
                  className="mb-6 w-full justify-start border-b border-border"
                >
                  <TabsTrigger value="versions">
                    Versionen{" "}
                    <Badge variant="secondary" className="ml-1">
                      14
                    </Badge>
                  </TabsTrigger>
                  <TabsTrigger value="comments">
                    Kommentare{" "}
                    <Badge variant="secondary" className="ml-1">
                      3
                    </Badge>
                  </TabsTrigger>
                </TabsList>
              </Tabs>

              {histTab === "versions" && (
                <div className="relative pl-2">
                  {versions.map((v, i) => (
                    <div key={v[0]} className="relative flex gap-4 pb-1.5">
                      <div className="flex shrink-0 flex-col items-center">
                        <span
                          className={cn(
                            "mt-5 size-3 shrink-0 rounded-full border-2",
                            v[8] ? "border-primary bg-primary" : "border-border bg-card",
                          )}
                        />
                        {i < versions.length - 1 && (
                          <span className="my-0.5 w-0.5 flex-1 bg-border" />
                        )}
                      </div>
                      <Card className={cn("mb-3.5 flex-1 gap-0 py-0", v[8] && "ring-primary/40")}>
                        <CardContent className="py-3.5">
                          <div className="mb-1.5 flex items-center gap-2.5">
                            <ColorAvatar initials={v[2]} color={v[3]} size="sm" />
                            <div className="flex-1">
                              <span className="text-[13.5px] font-semibold">{v[1]}</span>
                              <span className="text-[12.5px] text-muted-foreground"> · {v[4]}</span>
                            </div>
                            {v[8] && (
                              <Badge className="bg-emerald-500/15 text-emerald-600 dark:text-emerald-400">
                                Aktuell
                              </Badge>
                            )}
                            <Kbd>{v[0]}</Kbd>
                          </div>
                          <div className="mb-2.5 text-[13.5px] text-muted-foreground">{v[5]}</div>
                          <div className="flex items-center gap-3.5">
                            <span className="font-mono text-xs text-emerald-600 dark:text-emerald-400">
                              +{v[6]}
                            </span>
                            <span className="font-mono text-xs text-destructive">−{v[7]}</span>
                            <div className="flex-1" />
                            <Button variant="outline" size="xs">
                              Vergleichen
                            </Button>
                            {v[9] && (
                              <Button variant="outline" size="xs" className="text-primary">
                                Wiederherstellen
                              </Button>
                            )}
                          </div>
                        </CardContent>
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
                      <Card key={c[4]} className={cn(isResolved && "opacity-70")}>
                        <CardContent>
                          <div className="mb-2.5 flex items-center gap-2.5">
                            <ColorAvatar initials={c[1]} color={c[2]} size="sm" />
                            <div className="flex-1">
                              <span className="text-[13.5px] font-semibold">{c[0]}</span>
                              <span className="text-[12.5px] text-muted-foreground"> · {c[3]}</span>
                            </div>
                            {isResolved && (
                              <span className="inline-flex items-center gap-1 text-[11.5px] font-semibold text-emerald-600 dark:text-emerald-400">
                                <Check className="size-3.5" />
                                Gelöst
                              </span>
                            )}
                          </div>
                          <Badge variant="secondary" className="mb-2 text-primary">
                            Bezieht sich auf „{c[4]}“
                          </Badge>
                          <div className="text-sm leading-relaxed">{c[5]}</div>
                          <div className="mt-2.5 flex items-center gap-3.5">
                            <Button
                              variant="link"
                              size="sm"
                              className="h-auto p-0 text-muted-foreground"
                            >
                              Antworten
                            </Button>
                            {c[6] > 0 && (
                              <span className="text-[12.5px] text-muted-foreground">
                                {c[6]} Antwort
                              </span>
                            )}
                            <div className="flex-1" />
                            {!isResolved && (
                              <Button
                                variant="outline"
                                size="xs"
                                onClick={() => setResolved((s) => ({ ...s, [i]: true }))}
                              >
                                Als gelöst markieren
                              </Button>
                            )}
                          </div>
                        </CardContent>
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
                  <h1 className="text-2xl font-semibold tracking-tight">Spaces</h1>
                  <p className="mt-1 text-sm text-muted-foreground">
                    6 Bereiche · dein Zugriff wird pro Space verwaltet.
                  </p>
                </div>
                <Button size="sm">
                  <Plus /> Neuer Space
                </Button>
              </div>
              <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
                {spaces.map((s) => (
                  <Card
                    key={s[0]}
                    onClick={() => selectPage("erste-schritte")}
                    className="cursor-pointer transition-all hover:shadow-md hover:ring-primary/30"
                  >
                    <CardContent>
                      <div className="mb-3 flex items-center justify-between">
                        <div
                          className="flex size-11 items-center justify-center rounded-xl text-[15px] font-bold text-white shadow-sm"
                          style={{ backgroundColor: s[2] }}
                        >
                          {s[1]}
                        </div>
                        <RoleBadge role={s[6]} />
                      </div>
                      <div className="mb-1 text-base font-semibold">{s[0]}</div>
                      <div className="min-h-10 text-[13px] leading-normal text-muted-foreground">
                        {s[3]}
                      </div>
                      <div className="mt-3.5 flex items-center gap-3.5 border-t border-border pt-3 text-xs text-muted-foreground">
                        <span className="flex items-center gap-1.5">
                          <BookOpen className="size-3.5" />
                          {s[4]}
                        </span>
                        <span className="flex items-center gap-1.5">
                          <Users className="size-3.5" />
                          {s[5]}
                        </span>
                        <div className="flex-1" />
                        <span>{s[7]}</span>
                      </div>
                    </CardContent>
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
