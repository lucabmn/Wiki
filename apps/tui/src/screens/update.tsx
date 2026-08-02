import { TextAttributes } from "@opentui/core";
import { useKeyboard } from "@opentui/react";
import { useEffect, useState } from "react";
import { theme } from "../theme";
import { ensureStorageCredentials, isProduction, readConfig } from "../lib/config";
import { composeUp } from "../lib/docker";
import { gitInfo, gitPull } from "../lib/git";
import { LogBox, StatusRow, pollUntilHealthy, useRunLog } from "../components/run-log";

type Stage = "idle" | "running" | "done" | "error";

export function Update({ onExit }: { onExit: () => void }) {
  const [stage, setStage] = useState<Stage>("idle");
  const [git, setGit] = useState<{ rev: string; branch: string } | null>(null);
  const { log, statuses, setStatuses, append, reset } = useRunLog();

  useEffect(() => {
    let cancelled = false;
    gitInfo().then((g) => !cancelled && setGit(g));
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (stage !== "running") return;
    const ctrl = new AbortController();
    const { signal } = ctrl;
    (async () => {
      try {
        append("→ git pull --ff-only …");
        const pullCode = await gitPull((l) => !signal.aborted && append(l));
        if (signal.aborted) return;
        if (pullCode !== 0) {
          append(`✘ git pull fehlgeschlagen (Code ${pullCode}). Lokale Änderungen?`);
          return setStage("error");
        }

        // Migrations run inside the stack via the one-shot `migrate` service
        // before server/collab restart — no host-side tooling needed. Reuse
        // the install's mode: https configs restart with the TLS overlay.
        if (await ensureStorageCredentials()) {
          append("✔ Fehlende S3-Zugangsdaten für die bestehende Installation wurden ergänzt.");
        }
        const production = isProduction(await readConfig());
        append("→ Baue Images neu und starte Dienste (inkl. DB-Migrationen) …");
        const upCode = await composeUp(production, (l) => !signal.aborted && append(l));
        if (signal.aborted) return;
        if (upCode !== 0) {
          append(`✘ docker compose beendet mit Code ${upCode}.`);
          return setStage("error");
        }

        append("→ Warte auf Health-Checks …");
        const healthy = await pollUntilHealthy(setStatuses, signal);
        if (signal.aborted) return;
        append(healthy ? "✔ Update abgeschlossen." : "● Timeout — prüfe die Logs.");
        setStage("done");
      } catch (err) {
        if (signal.aborted) return;
        append(`✘ ${err instanceof Error ? err.message : String(err)}`);
        setStage("error");
      }
    })();
    return () => ctrl.abort();
  }, [stage]);

  useKeyboard((key) => {
    if (stage === "idle") {
      if (key.name === "escape") return onExit();
      if (key.name === "return" || key.name === "enter") {
        reset();
        return setStage("running");
      }
    } else if (stage === "done") {
      if (key.name === "escape" || key.name === "return" || key.name === "enter") onExit();
    } else if (stage === "error") {
      if (key.name === "escape") return onExit();
      if (key.name === "r") {
        reset();
        return setStage("running");
      }
    }
  });

  return (
    <box flexDirection="column" flexGrow={1} padding={1} gap={1}>
      <box flexDirection="column">
        <text fg={theme.accent} attributes={TextAttributes.BOLD}>
          Update
        </text>
        <text fg={theme.dim}>git pull · Images neu bauen · Migrationen · Dienste neu starten.</text>
      </box>

      {stage === "idle" && (
        <box flexDirection="column" gap={1} flexGrow={1}>
          <box border borderStyle="rounded" borderColor={theme.border} padding={1}>
            <box flexDirection="row" gap={1}>
              <text fg={theme.dim}>Branch</text>
              <text fg={theme.fg}>{git?.branch ?? "…"}</text>
            </box>
            <box flexDirection="row" gap={1}>
              <text fg={theme.dim}>Commit</text>
              <text fg={theme.fg}>{git?.rev ?? "…"}</text>
            </box>
          </box>
          <box border borderStyle="rounded" borderColor={theme.accentDim} padding={1}>
            <text fg={theme.fg}>
              <span fg={theme.accent}>Enter</span> zieht den neuesten Code und baut den Stack neu.
              Nur Fast-Forward — lokale Commits blockieren das Update.
            </text>
          </box>
        </box>
      )}
      {(stage === "running" || stage === "done" || stage === "error") && (
        <box flexDirection="column" gap={1} flexGrow={1}>
          <StatusRow statuses={statuses} />
          <LogBox log={log} title=" Update " />
          {stage === "done" && (
            <box border borderStyle="rounded" borderColor={theme.ok} padding={1}>
              <text fg={theme.ok} attributes={TextAttributes.BOLD}>
                Update abgeschlossen.
              </text>
            </box>
          )}
        </box>
      )}

      <Footer stage={stage} />
    </box>
  );
}

function Footer({ stage }: { stage: Stage }) {
  const hint = (k: string, label: string) => (
    <text fg={theme.dim}>
      <span fg={theme.accent}>{k}</span> {label}
    </text>
  );
  return (
    <box flexDirection="row" gap={2} paddingX={1}>
      {stage === "idle" && (
        <>
          {hint("Enter", "Update starten")}
          {hint("Esc", "Zurück")}
        </>
      )}
      {stage === "running" && <text fg={theme.dim}>Läuft … bitte warten.</text>}
      {stage === "done" && hint("Enter/Esc", "Zum Menü")}
      {stage === "error" && (
        <>
          {hint("r", "Erneut versuchen")}
          {hint("Esc", "Zum Menü")}
        </>
      )}
    </box>
  );
}
