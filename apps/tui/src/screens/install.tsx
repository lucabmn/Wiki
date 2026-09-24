import { TextAttributes } from "@opentui/core";
import { useKeyboard } from "@opentui/react";
import { existsSync } from "node:fs";
import { useEffect, useState } from "react";
import { theme } from "../theme";
import {
  defaultConfig,
  fields,
  isProduction,
  isValid,
  renderEnvFiles,
  writeEnvFiles,
  type InstallConfig,
} from "../lib/config";
import { envPath } from "../lib/paths";
import { ConfigFormView, useConfigForm } from "../components/config-form";
import { LogBox, StatusRow, upAndWaitHealthy, useRunLog } from "../components/run-log";

type Stage = "form" | "review" | "installing" | "done" | "error";

export function InstallWizard({ onExit }: { onExit: () => void }) {
  const [stage, setStage] = useState<Stage>("form");
  const [config, setConfig] = useState<InstallConfig>(defaultConfig);
  const { log, statuses, setStatuses, append, reset } = useRunLog();

  const { fieldIndex, errors } = useConfigForm({
    config,
    setConfig,
    onSubmit: () => setStage("review"),
    onCancel: onExit,
    enabled: stage === "form",
  });

  // ── Install orchestration ──────────────────────────────────────────────────
  useEffect(() => {
    if (stage !== "installing") return;
    const ctrl = new AbortController();
    const { signal } = ctrl;

    (async () => {
      try {
        append("→ Schreibe .env Dateien …");
        const written = await writeEnvFiles(config);
        written.forEach((p) => append(`  ✔ ${p}`));

        // Migrations run inside the stack: the one-shot `migrate` service
        // applies them before server/collab start (see docker-compose.yml),
        // so the host needs nothing beyond Docker. https configs additionally
        // bring up the Caddy TLS overlay.
        const production = isProduction(config);
        if (production) append("→ Produktionsmodus: Caddy-TLS-Overlay wird mitgestartet.");
        append("→ Baue Images und starte alle Dienste (inkl. DB-Migrationen) …");
        const result = await upAndWaitHealthy({
          production,
          append,
          onStatuses: setStatuses,
          signal,
          successMessage: "✔ Alle Dienste laufen.",
        });
        if (result !== "aborted") setStage(result);
      } catch (err) {
        if (signal.aborted) return;
        append(`✘ ${err instanceof Error ? err.message : String(err)}`);
        setStage("error");
      }
    })();

    return () => ctrl.abort();
  }, [stage]);

  // ── Keyboard for non-form stages ────────────────────────────────────────────
  useKeyboard((key) => {
    if (stage === "review") {
      if (key.name === "escape") return setStage("form");
      if (key.name === "return" || key.name === "enter") {
        reset();
        return setStage("installing");
      }
    } else if (stage === "done") {
      if (key.name === "escape" || key.name === "return" || key.name === "enter") onExit();
    } else if (stage === "error") {
      if (key.name === "escape") return onExit();
      if (key.name === "r") {
        reset();
        return setStage("installing");
      }
    }
  });

  return (
    <box flexDirection="column" flexGrow={1} padding={1} gap={1}>
      <box flexDirection="column" flexShrink={0}>
        <text fg={theme.accent} attributes={TextAttributes.BOLD}>
          Installation — Self-Hosted Wiki
        </text>
        <text fg={theme.dim}>{stageHint(stage)}</text>
      </box>

      {stage === "form" && (
        <ConfigFormView
          config={config}
          fieldIndex={fieldIndex}
          errors={errors}
          setConfig={setConfig}
        />
      )}
      {stage === "review" && <ReviewStage config={config} />}
      {(stage === "installing" || stage === "done" || stage === "error") && (
        <box flexDirection="column" gap={1} flexGrow={1}>
          <StatusRow statuses={statuses} />
          <LogBox log={log} title=" Installation " />
          {stage === "done" && <DoneNote config={config} />}
        </box>
      )}

      <Footer
        stage={stage}
        valid={isValid(config)}
        lastField={fieldIndex === fields.length - 1}
        secretField={!!fields[fieldIndex]?.secret}
      />
    </box>
  );
}

function stageHint(stage: Stage): string {
  switch (stage) {
    case "form":
      return "Werte prüfen — Secrets sind bereits generiert.";
    case "review":
      return "Diese .env Dateien werden geschrieben (↑↓ scrollt).";
    case "installing":
      return "Images bauen · Migrationen · Dienste starten …";
    case "done":
      return "Fertig.";
    case "error":
      return "Fehlgeschlagen.";
  }
}

function ReviewStage({ config }: { config: InstallConfig }) {
  const files = renderEnvFiles(config);
  // Re-running Install over a live stack replaces its secrets; the existing
  // Postgres volume keeps the old password, so warn before overwriting.
  const existing = existsSync(envPath(".env"));
  return (
    <scrollbox flexGrow={1} focused>
      {existing && (
        <box border borderStyle="rounded" borderColor={theme.warn} paddingX={1} marginBottom={1}>
          <text fg={theme.warn}>
            Achtung: Es gibt bereits eine .env — sie wird überschrieben. Das neue DB-Passwort passt
            nicht zu einem bestehenden Postgres-Volume. Für bestehende Installationen
            „Konfigurieren" nutzen.
          </text>
        </box>
      )}
      {files.map((f) => (
        <box
          key={f.rel}
          flexDirection="column"
          border
          borderStyle="rounded"
          borderColor={theme.border}
          title={` ${f.rel} `}
          titleColor={theme.accent}
          paddingX={1}
          marginBottom={1}
        >
          {f.content
            .trimEnd()
            .split("\n")
            .map((line, i) => {
              const [k, ...rest] = line.split("=");
              const v = rest.join("=");
              const secret = /SECRET|PASSWORD|ACCESS_KEY/.test(k ?? "");
              return (
                <box key={i} flexDirection="row" gap={1}>
                  <text fg={theme.dim} flexShrink={0}>
                    {k}
                  </text>
                  <text fg={secret ? theme.warn : theme.fg}>
                    {secret ? maskValue(v) : maskUrlPassword(v)}
                  </text>
                </box>
              );
            })}
        </box>
      ))}
    </scrollbox>
  );
}

function DoneNote({ config }: { config: InstallConfig }) {
  return (
    <box border borderStyle="rounded" borderColor={theme.ok} padding={1}>
      <text fg={theme.ok} attributes={TextAttributes.BOLD}>
        Installation abgeschlossen.
      </text>
      <text fg={theme.fg}>
        Öffne <span fg={theme.accent}>{config.webUrl}</span> und registriere den ersten Benutzer —
        das Onboarding legt die erste Organisation an.
      </text>
    </box>
  );
}

function Footer({
  stage,
  valid,
  lastField,
  secretField,
}: {
  stage: Stage;
  valid: boolean;
  lastField: boolean;
  secretField: boolean;
}) {
  const hint = (k: string, label: string) => (
    <text fg={theme.dim}>
      <span fg={theme.accent}>{k}</span> {label}
    </text>
  );
  return (
    <box flexDirection="row" gap={2} paddingX={1} flexShrink={0}>
      {stage === "form" && (
        <>
          {hint("↑↓/Tab", "Feld")}
          {secretField && hint("Ctrl+R", "Secret neu")}
          {hint("Enter", lastField ? (valid ? "Weiter" : "Zum Fehler") : "Nächstes Feld")}
          {hint("Esc", "Zurück")}
        </>
      )}
      {stage === "review" && (
        <>
          {hint("Enter", "Installieren")}
          {hint("Esc", "Zurück")}
        </>
      )}
      {stage === "installing" && <text fg={theme.dim}>Läuft … bitte warten.</text>}
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

function maskValue(v: string): string {
  if (v.length <= 6) return "••••••";
  return `${"•".repeat(6)}${v.slice(-4)}`;
}

/** Hide the password inside a DSN like `postgresql://user:pass@host` (DATABASE_URL). */
function maskUrlPassword(v: string): string {
  return v.replace(/^([a-z][a-z0-9+.-]*:\/\/[^:/@]+:)[^@]+@/i, "$1••••••@");
}
