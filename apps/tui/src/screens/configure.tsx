import { TextAttributes } from "@opentui/core";
import { useKeyboard } from "@opentui/react";
import { useEffect, useState } from "react";
import { theme } from "../theme";
import {
  defaultConfig,
  fields,
  isValid,
  readConfig,
  writeEnvFiles,
  type InstallConfig,
} from "../lib/config";

// Configure edits only the URLs. Secrets (DB password, auth secret) are shown
// read-only: rotating them on a live install is destructive (a new
// POSTGRES_PASSWORD does not re-key the existing volume; a new auth secret logs
// everyone out), so they belong to a dedicated flow, not routine config edits.
const EDITABLE = fields.filter((f) => !f.secret);
const SECRETS = fields.filter((f) => f.secret);
import { composeUp } from "../lib/docker";
import { ConfigFormView, useConfigForm } from "../components/config-form";
import { LogBox, StatusRow, pollUntilHealthy, useRunLog } from "../components/run-log";

type Stage = "loading" | "form" | "applying" | "done" | "error";

export function Configure({ onExit }: { onExit: () => void }) {
  const [stage, setStage] = useState<Stage>("loading");
  const [config, setConfig] = useState<InstallConfig | null>(null);
  const { log, statuses, setStatuses, append, reset } = useRunLog();

  // Load current config from disk once.
  useEffect(() => {
    let cancelled = false;
    readConfig().then((c) => {
      if (cancelled) return;
      setConfig(c);
      setStage("form");
    });
    return () => {
      cancelled = true;
    };
  }, []);

  // A throwaway placeholder keeps the hook's `validate()` well-formed while the
  // real config loads; it is inert (`enabled` is false) and replaced on load.
  const { fieldIndex, errors } = useConfigForm({
    config: config ?? defaultConfig(),
    setConfig: (updater) => setConfig((c) => (c ? updater(c) : c)),
    onSubmit: () => setStage("applying"),
    onCancel: onExit,
    enabled: stage === "form" && config !== null,
    formFields: EDITABLE,
  });

  // Apply changes: rewrite env files, rebuild + restart the stack.
  useEffect(() => {
    if (stage !== "applying" || !config) return;
    const ctrl = new AbortController();
    const { signal } = ctrl;
    (async () => {
      try {
        append("→ Schreibe .env Dateien …");
        const written = await writeEnvFiles(config);
        written.forEach((p) => append(`  ✔ ${p}`));
        append("→ Baue neu und starte Dienste (up -d --build) …");
        const code = await composeUp((l) => !signal.aborted && append(l));
        if (signal.aborted) return;
        if (code !== 0) {
          append(`✘ docker compose beendet mit Code ${code}.`);
          return setStage("error");
        }
        append("→ Warte auf Health-Checks …");
        const healthy = await pollUntilHealthy(setStatuses, signal);
        if (signal.aborted) return;
        append(healthy ? "✔ Übernommen." : "● Timeout — prüfe die Logs.");
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
    if (stage === "done") {
      if (key.name === "escape" || key.name === "return" || key.name === "enter") onExit();
    } else if (stage === "error") {
      if (key.name === "escape") return onExit();
      if (key.name === "r") {
        reset();
        return setStage("applying");
      }
    }
  });

  return (
    <box flexDirection="column" flexGrow={1} padding={1} gap={1}>
      <box flexDirection="column">
        <text fg={theme.accent} attributes={TextAttributes.BOLD}>
          Konfiguration
        </text>
        <text fg={theme.dim}>{stageHint(stage)}</text>
      </box>

      {stage === "loading" && <text fg={theme.dim}>Lade aktuelle Konfiguration …</text>}
      {stage === "form" && config && (
        <ConfigFormView
          config={config}
          fieldIndex={fieldIndex}
          errors={errors}
          setConfig={(updater) => setConfig((c) => (c ? updater(c) : c))}
          formFields={EDITABLE}
          readonlyFields={SECRETS}
        />
      )}
      {(stage === "applying" || stage === "done" || stage === "error") && (
        <box flexDirection="column" gap={1} flexGrow={1}>
          <StatusRow statuses={statuses} />
          <LogBox log={log} title=" Übernehmen " />
          {stage === "done" && (
            <box border borderStyle="rounded" borderColor={theme.ok} padding={1}>
              <text fg={theme.ok} attributes={TextAttributes.BOLD}>
                Konfiguration übernommen.
              </text>
            </box>
          )}
        </box>
      )}

      <Footer
        stage={stage}
        valid={config ? isValid(config) : false}
        lastField={fieldIndex === EDITABLE.length - 1}
      />
    </box>
  );
}

function stageHint(stage: Stage): string {
  switch (stage) {
    case "loading":
      return "Lese die .env Dateien …";
    case "form":
      return "Werte bearbeiten — Enter auf dem letzten Feld übernimmt.";
    case "applying":
      return "Schreibe Config und starte Dienste neu …";
    case "done":
      return "Fertig.";
    case "error":
      return "Fehlgeschlagen.";
  }
}

function Footer({ stage, valid, lastField }: { stage: Stage; valid: boolean; lastField: boolean }) {
  const hint = (k: string, label: string) => (
    <text fg={theme.dim}>
      <span fg={theme.accent}>{k}</span> {label}
    </text>
  );
  return (
    <box flexDirection="row" gap={2} paddingX={1}>
      {stage === "form" && (
        <>
          {hint("↑↓/Tab", "Feld")}
          {hint("Ctrl+R", "Secret neu")}
          {hint("Enter", lastField ? (valid ? "Übernehmen" : "— ungültig") : "Nächstes Feld")}
          {hint("Esc", "Zurück")}
        </>
      )}
      {stage === "applying" && <text fg={theme.dim}>Läuft … bitte warten.</text>}
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
