import { createCliRenderer, TextAttributes } from "@opentui/core";
import { createRoot, useKeyboard, useRenderer } from "@opentui/react";
import { useState } from "react";

// ── Theme ────────────────────────────────────────────────────────────────
const theme = {
  accent: "#7c5cff",
  accentDim: "#4b3a99",
  fg: "#e6e6f0",
  dim: "#8a8aa0",
  ok: "#3ecf8e",
  warn: "#e6b422",
  err: "#ff5c5c",
  panel: "#16161f",
  panelAlt: "#1e1e2a",
  border: "#2c2c3c",
};

// ── Fake data ────────────────────────────────────────────────────────────
type Status = "ok" | "warn" | "err";

const system = {
  version: "1.4.2",
  latest: "1.5.0",
  status: "running" as "running" | "stopped",
  uptime: "4d 12h 33m",
  host: "wiki.nilovon.local",
  port: 8080,
  dbSize: "142 MB",
  users: 27,
  pages: 314,
};

const installSteps: { label: string; status: Status; detail: string }[] = [
  { label: "Docker Engine", status: "ok", detail: "v27.1.1 erkannt" },
  { label: "PostgreSQL", status: "ok", detail: "v16 bereit" },
  { label: "Nilovon Core", status: "warn", detail: "nicht installiert" },
  { label: "Reverse Proxy", status: "warn", detail: "nicht konfiguriert" },
  { label: "TLS Zertifikate", status: "err", detail: "fehlend" },
];

const configItems: { key: string; value: string }[] = [
  { key: "Instanz-Name", value: "Nilovon Wiki" },
  { key: "Basis-URL", value: "https://wiki.nilovon.local" },
  { key: "Port", value: "8080" },
  { key: "DB Host", value: "localhost:5432" },
  { key: "Auth Provider", value: "Better Auth (email)" },
  { key: "Öffentliche Registrierung", value: "deaktiviert" },
  { key: "Uploads Max", value: "50 MB" },
  { key: "Backup Zeitplan", value: "täglich 03:00" },
];

const updateChangelog: string[] = [
  "Neue Editor-Toolbar mit Slash-Kommandos",
  "Schnellere Volltextsuche (bis zu 3x)",
  "Fix: Broken Links im Sidebar-Baum",
  "Sicherheitsupdate für Session-Handling",
  "Dark-Mode Feinschliff",
];

// ── Shared UI ────────────────────────────────────────────────────────────
const statusColor: Record<Status, string> = {
  ok: theme.ok,
  warn: theme.warn,
  err: theme.err,
};
const statusGlyph: Record<Status, string> = {
  ok: "✔",
  warn: "●",
  err: "✘",
};

function Row({ left, right, color }: { left: string; right: string; color?: string }) {
  return (
    <box flexDirection="row" justifyContent="space-between">
      <text fg={theme.dim}>{left}</text>
      <text fg={color ?? theme.fg}>{right}</text>
    </box>
  );
}

function SectionTitle({ text }: { text: string }) {
  return (
    <text fg={theme.accent} attributes={TextAttributes.BOLD}>
      {text}
    </text>
  );
}

// ── Panels ───────────────────────────────────────────────────────────────
function InstallPanel() {
  const ready = installSteps.filter((s) => s.status === "ok").length;
  return (
    <box flexDirection="column" gap={1} padding={1}>
      <SectionTitle text="Installation" />
      <text fg={theme.dim}>
        Richte dein selbst-gehostetes Nilovon Wiki ein. {ready}/{installSteps.length}{" "}
        Voraussetzungen erfüllt.
      </text>
      <box flexDirection="column" marginTop={1}>
        {installSteps.map((s) => (
          <box key={s.label} flexDirection="row" gap={1} justifyContent="space-between">
            <box flexDirection="row" gap={1}>
              <text fg={statusColor[s.status]}>{statusGlyph[s.status]}</text>
              <text fg={theme.fg}>{s.label}</text>
            </box>
            <text fg={theme.dim}>{s.detail}</text>
          </box>
        ))}
      </box>
      <box marginTop={1} border borderStyle="rounded" borderColor={theme.accentDim} padding={1}>
        <text fg={theme.fg}>
          Drücke <span fg={theme.accent}>Enter</span> um die Installation zu starten (fake).
        </text>
      </box>
    </box>
  );
}

function ConfigPanel() {
  return (
    <box flexDirection="column" gap={1} padding={1}>
      <SectionTitle text="Konfiguration" />
      <text fg={theme.dim}>Aktuelle Einstellungen deiner Instanz.</text>
      <box flexDirection="column" marginTop={1} gap={0}>
        {configItems.map((c, i) => (
          <box key={c.key} backgroundColor={i % 2 === 0 ? theme.panelAlt : undefined} paddingX={1}>
            <Row left={c.key} right={c.value} />
          </box>
        ))}
      </box>
      <box marginTop={1} border borderStyle="rounded" borderColor={theme.accentDim} padding={1}>
        <text fg={theme.fg}>
          Drücke <span fg={theme.accent}>Enter</span> um einen Wert zu bearbeiten (fake).
        </text>
      </box>
    </box>
  );
}

function UpdatePanel() {
  const hasUpdate = system.version !== system.latest;
  return (
    <box flexDirection="column" gap={1} padding={1}>
      <SectionTitle text="Update" />
      <box flexDirection="column" marginTop={0}>
        <Row left="Installierte Version" right={`v${system.version}`} />
        <Row
          left="Neueste Version"
          right={`v${system.latest}`}
          color={hasUpdate ? theme.warn : theme.ok}
        />
      </box>
      {hasUpdate ? (
        <box flexDirection="column" gap={1} marginTop={1}>
          <text fg={theme.warn} attributes={TextAttributes.BOLD}>
            Update verfügbar → v{system.latest}
          </text>
          <text fg={theme.dim}>Änderungen:</text>
          <box flexDirection="column">
            {updateChangelog.map((line) => (
              <box key={line} flexDirection="row" gap={1}>
                <text fg={theme.accent}>•</text>
                <text fg={theme.fg}>{line}</text>
              </box>
            ))}
          </box>
        </box>
      ) : (
        <text fg={theme.ok} attributes={TextAttributes.BOLD}>
          System ist aktuell.
        </text>
      )}
      <box marginTop={1} border borderStyle="rounded" borderColor={theme.accentDim} padding={1}>
        <text fg={theme.fg}>
          Drücke <span fg={theme.accent}>Enter</span> um auf v{system.latest} zu aktualisieren
          (fake).
        </text>
      </box>
    </box>
  );
}

const menu = [
  {
    key: "install",
    name: "Installieren",
    desc: "Voraussetzungen prüfen & einrichten",
    Panel: InstallPanel,
  },
  {
    key: "configure",
    name: "Konfigurieren",
    desc: "Einstellungen der Instanz verwalten",
    Panel: ConfigPanel,
  },
  { key: "update", name: "Updaten", desc: "Auf neueste Version aktualisieren", Panel: UpdatePanel },
];

// ── Layout pieces ────────────────────────────────────────────────────────
function StatusBadge() {
  const running = system.status === "running";
  return (
    <box flexDirection="row" gap={1} alignItems="center">
      <text fg={running ? theme.ok : theme.err}>{running ? "●" : "○"}</text>
      <text fg={theme.dim}>{running ? "läuft" : "gestoppt"}</text>
    </box>
  );
}

function Sidebar({ active, onNav }: { active: number; onNav: (i: number) => void }) {
  return (
    <box
      flexDirection="column"
      width={30}
      border
      borderStyle="rounded"
      borderColor={theme.border}
      title=" Menü "
      titleColor={theme.accent}
      padding={1}
      gap={1}
    >
      {menu.map((m, i) => {
        const on = i === active;
        return (
          <box
            key={m.key}
            flexDirection="column"
            paddingX={1}
            backgroundColor={on ? theme.accentDim : undefined}
            onMouseDown={() => onNav(i)}
          >
            <box flexDirection="row" gap={1}>
              <text fg={on ? theme.fg : theme.dim}>{on ? "▶" : " "}</text>
              <text
                fg={on ? theme.fg : theme.dim}
                attributes={on ? TextAttributes.BOLD : undefined}
              >
                {m.name}
              </text>
            </box>
            <text fg={theme.dim}> {m.desc}</text>
          </box>
        );
      })}
      <box flexGrow={1} />
      <text fg={theme.border}>{"─".repeat(26)}</text>
      <box flexDirection="column">
        <Row left="Host" right={system.host} />
        <Row left="Nutzer" right={String(system.users)} />
        <Row left="Seiten" right={String(system.pages)} />
        <Row left="DB" right={system.dbSize} />
      </box>
    </box>
  );
}

function App() {
  const renderer = useRenderer();
  const [active, setActive] = useState(0);

  useKeyboard((key) => {
    if (key.name === "q" || key.name === "escape") {
      renderer.destroy();
      return;
    }
    if (key.name === "up" || key.name === "k") {
      setActive((i: number) => (i - 1 + menu.length) % menu.length);
    }
    if (key.name === "down" || key.name === "j" || key.name === "tab") {
      setActive((i: number) => (i + 1) % menu.length);
    }
    if (key.name >= "1" && key.name <= String(menu.length)) {
      setActive(Number(key.name) - 1);
    }
  });

  const current = menu[active]!;
  const Panel = current.Panel;

  return (
    <box flexDirection="column" flexGrow={1} padding={1} gap={1}>
      {/* Header */}
      <box flexDirection="row" justifyContent="space-between" alignItems="flex-end">
        <box flexDirection="column">
          <ascii-font font="tiny" text="Nilovon Wiki" />
          <text attributes={TextAttributes.DIM}>
            Self-Hosted · Installieren, Konfigurieren, Updaten
          </text>
        </box>
        <box flexDirection="column" alignItems="flex-end">
          <StatusBadge />
          <text fg={theme.dim}>uptime {system.uptime}</text>
        </box>
      </box>

      {/* Body */}
      <box flexDirection="row" flexGrow={1} gap={1}>
        <Sidebar active={active} onNav={setActive} />
        <box
          flexGrow={1}
          border
          borderStyle="rounded"
          borderColor={theme.border}
          title={` ${current.name} `}
          titleColor={theme.accent}
        >
          <Panel />
        </box>
      </box>

      {/* Footer */}
      <box flexDirection="row" gap={2} paddingX={1}>
        <text fg={theme.dim}>
          <span fg={theme.accent}>↑↓/jk</span> Navigation
        </text>
        <text fg={theme.dim}>
          <span fg={theme.accent}>1-3</span> Direktwahl
        </text>
        <text fg={theme.dim}>
          <span fg={theme.accent}>Enter</span> Aktion
        </text>
        <text fg={theme.dim}>
          <span fg={theme.accent}>q</span> Beenden
        </text>
      </box>
    </box>
  );
}

const renderer = await createCliRenderer({ exitOnCtrlC: true });
createRoot(renderer).render(<App />);
