import { createCliRenderer, TextAttributes } from "@opentui/core";
import { createRoot, useKeyboard, useRenderer } from "@opentui/react";
import { useState } from "react";
import { theme } from "./theme";
import { InstallWizard } from "./screens/install";
import { Configure } from "./screens/configure";
import { Update } from "./screens/update";

type Screen = "menu" | "install" | "configure" | "update";

const menu = [
  { key: "install", name: "Installieren", desc: "Stack konfigurieren & starten", ready: true },
  {
    key: "configure",
    name: "Konfigurieren",
    desc: "Einstellungen ändern & neu starten",
    ready: true,
  },
  { key: "update", name: "Updaten", desc: "Code ziehen & Stack neu bauen", ready: true },
];

function Menu({ onOpen, onQuit }: { onOpen: (screen: Screen) => void; onQuit: () => void }) {
  const [active, setActive] = useState(0);

  useKeyboard((key) => {
    if (key.name === "q" || key.name === "escape") return onQuit();
    if (key.name === "up" || key.name === "k")
      return setActive((i) => (i - 1 + menu.length) % menu.length);
    if (key.name === "down" || key.name === "j") return setActive((i) => (i + 1) % menu.length);
    if (key.name >= "1" && key.name <= String(menu.length)) return setActive(Number(key.name) - 1);
    if (key.name === "return" || key.name === "enter") {
      const item = menu[active]!;
      if (item.ready) onOpen(item.key as Screen);
    }
  });

  return (
    <box flexDirection="column" flexGrow={1} padding={1} gap={1}>
      <box flexDirection="column">
        <ascii-font font="tiny" text="Wiki" />
        <text attributes={TextAttributes.DIM}>
          Self-Hosted · Installieren, Konfigurieren, Updaten
        </text>
      </box>

      <box
        flexDirection="column"
        flexGrow={1}
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
              onMouseDown={() => setActive(i)}
            >
              <box flexDirection="row" gap={1}>
                <text fg={on ? theme.fg : theme.dim}>{on ? "▶" : " "}</text>
                <text
                  fg={m.ready ? (on ? theme.fg : theme.dim) : theme.border}
                  attributes={on ? TextAttributes.BOLD : undefined}
                >
                  {m.name}
                </text>
              </box>
              <text fg={theme.dim}> {m.desc}</text>
            </box>
          );
        })}
      </box>

      <box flexDirection="row" gap={2} paddingX={1}>
        <text fg={theme.dim}>
          <span fg={theme.accent}>↑↓/jk</span> Navigation
        </text>
        <text fg={theme.dim}>
          <span fg={theme.accent}>Enter</span> Öffnen
        </text>
        <text fg={theme.dim}>
          <span fg={theme.accent}>q</span> Beenden
        </text>
      </box>
    </box>
  );
}

function App() {
  const renderer = useRenderer();
  const [screen, setScreen] = useState<Screen>("menu");

  const back = () => setScreen("menu");
  if (screen === "install") return <InstallWizard onExit={back} />;
  if (screen === "configure") return <Configure onExit={back} />;
  if (screen === "update") return <Update onExit={back} />;
  return <Menu onOpen={setScreen} onQuit={() => renderer.destroy()} />;
}

const renderer = await createCliRenderer({ exitOnCtrlC: true });
createRoot(renderer).render(<App />);
