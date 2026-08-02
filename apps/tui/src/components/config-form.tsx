import { TextAttributes } from "@opentui/core";
import { useKeyboard } from "@opentui/react";
import { useState } from "react";
import { theme } from "../theme";
import {
  fields,
  isValid,
  validate,
  type FieldDef,
  type FieldErrors,
  type InstallConfig,
} from "../lib/config";
import { generatePassword, generateSecret } from "../lib/secrets";

/**
 * Keyboard + focus model shared by the install and configure forms:
 * ↑↓/Tab move between fields, Ctrl+R regenerates the focused secret, Enter
 * advances (and submits once valid on the last field), Esc cancels. Typed
 * characters fall through to the focused `<input>`.
 *
 * `formFields` is the navigable/editable subset — install passes all fields,
 * configure passes only the non-secret ones (rotating a live DB password or
 * auth secret is destructive, so those stay read-only there). Enter-to-submit
 * is still gated on `isValid(config)`, which validates every field — so a
 * missing secret (unreadable install) blocks the save.
 */
export function useConfigForm(opts: {
  config: InstallConfig;
  setConfig: (updater: (c: InstallConfig) => InstallConfig) => void;
  onSubmit: () => void;
  onCancel: () => void;
  /** When false the handler is inert (another stage owns the keyboard). */
  enabled: boolean;
  /** Editable/navigable fields (default: all). */
  formFields?: FieldDef[];
}): { fieldIndex: number; errors: FieldErrors } {
  const { config, setConfig, onSubmit, onCancel, enabled } = opts;
  const formFields = opts.formFields ?? fields;
  const [fieldIndex, setFieldIndex] = useState(0);
  const errors = validate(config);
  const field = formFields[fieldIndex]!;

  useKeyboard((key) => {
    if (!enabled) return;
    if (key.name === "escape") return onCancel();
    if (key.name === "up")
      return setFieldIndex((i) => (i - 1 + formFields.length) % formFields.length);
    if (key.name === "down" || key.name === "tab")
      return setFieldIndex((i) => (i + 1) % formFields.length);
    if (key.ctrl && key.name === "r") {
      // Only meaningful for secret fields, which are editable in install only.
      if (field.key === "authSecret") setConfig((c) => ({ ...c, authSecret: generateSecret() }));
      if (field.key === "postgresPassword")
        setConfig((c) => ({ ...c, postgresPassword: generatePassword() }));
      if (field.key === "s3AccessKeyId")
        setConfig((c) => ({ ...c, s3AccessKeyId: generatePassword(16) }));
      if (field.key === "s3SecretAccessKey")
        setConfig((c) => ({ ...c, s3SecretAccessKey: generateSecret() }));
      return;
    }
    if (key.name === "return" || key.name === "enter") {
      if (fieldIndex < formFields.length - 1) return setFieldIndex((i) => i + 1);
      if (isValid(config)) return onSubmit();
    }
  });

  return { fieldIndex, errors };
}

export function ConfigFormView({
  config,
  fieldIndex,
  errors,
  setConfig,
  formFields = fields,
  readonlyFields = [],
}: {
  config: InstallConfig;
  fieldIndex: number;
  errors: FieldErrors;
  setConfig: (updater: (c: InstallConfig) => InstallConfig) => void;
  /** Editable fields, matching what {@link useConfigForm} navigates. */
  formFields?: FieldDef[];
  /** Read-only fields shown for reference (masked if secret). */
  readonlyFields?: FieldDef[];
}) {
  const active = formFields[fieldIndex]!;
  return (
    <box flexDirection="column" gap={1} flexGrow={1}>
      <box flexDirection="column" gap={1}>
        {formFields.map((f, i) => {
          const on = i === fieldIndex;
          const err = errors[f.key];
          return (
            <box key={f.key} flexDirection="row" gap={1} alignItems="center">
              <text fg={on ? theme.accent : theme.dim}>{on ? "▶" : " "}</text>
              <text fg={theme.dim} attributes={on ? TextAttributes.BOLD : undefined}>
                {f.label.padEnd(12)}
              </text>
              <input
                value={config[f.key]}
                onChange={(v: string) => setConfig((c) => ({ ...c, [f.key]: v }))}
                focused={on}
                width={52}
                backgroundColor={theme.panelAlt}
                textColor={theme.fg}
                cursorColor={theme.accent}
                focusedBackgroundColor={theme.panel}
              />
              <text fg={err ? theme.err : theme.ok}>{err ? "✘" : "✔"}</text>
            </box>
          );
        })}
      </box>

      {readonlyFields.length > 0 ? (
        <box flexDirection="column">
          {readonlyFields.map((f) => {
            const err = errors[f.key];
            const value = config[f.key];
            return (
              <box key={f.key} flexDirection="row" gap={1} alignItems="center">
                <text fg={theme.dim}> </text>
                <text fg={theme.dim}>{f.label.padEnd(12)}</text>
                <text fg={err ? theme.err : theme.dim}>
                  {err ? "— fehlt (Installation nötig)" : maskSecret(value)}
                </text>
              </box>
            );
          })}
        </box>
      ) : null}

      <box border borderStyle="rounded" borderColor={theme.accentDim} padding={1}>
        <text fg={theme.dim}>{active.help}</text>
        {errors[active.key] ? <text fg={theme.err}>Fehler: {errors[active.key]}</text> : null}
        {active.secret ? (
          <text fg={theme.dim}>
            <span fg={theme.accent}>Ctrl+R</span> generiert einen neuen Wert.
          </text>
        ) : null}
        {readonlyFields.length > 0 ? (
          <text fg={theme.dim}>
            Secrets sind schreibgeschützt — Rotation ist ein separater, destruktiver Schritt.
          </text>
        ) : null}
      </box>
    </box>
  );
}

function maskSecret(v: string): string {
  if (!v) return "—";
  if (v.length <= 6) return "••••••";
  return `${"•".repeat(6)}${v.slice(-4)}`;
}
