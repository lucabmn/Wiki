import { useState } from "react";

import { Field, FieldDescription, FieldLabel } from "@nilovon-wiki/ui/components/field";
import { Input } from "@nilovon-wiki/ui/components/input";
import { NativeSelect, NativeSelectOption } from "@nilovon-wiki/ui/components/native-select";

/**
 * The retention policy editor: how long the audit log and the trash live.
 *
 * A controlled component over `RetentionPolicy`, like `DigestForm` — it knows
 * nothing about who is editing or how it is saved, so the settings page owns the
 * confirmation flow (shortening a window destroys data, and that needs numbers
 * in front of the admin before they agree to it).
 */

export type RetentionPolicy = {
  /** null = keep forever. */
  auditRetentionDays: number | null;
  trashRetentionDays: number;
};

export const MIN_DAYS = 1;
export const MAX_DAYS = 3650;

/** Presets cover the answers people actually give; "Andere" opens the input. */
const AUDIT_PRESETS = [
  { value: "unlimited", label: "Unbegrenzt aufbewahren", days: null },
  { value: "365", label: "1 Jahr", days: 365 },
  { value: "730", label: "2 Jahre", days: 730 },
  { value: "1095", label: "3 Jahre", days: 1095 },
  { value: "custom", label: "Andere Frist …", days: 0 },
] as const;

const TRASH_PRESETS = [7, 14, 30, 60, 90];

export function describeRetention(policy: RetentionPolicy): string {
  const audit =
    policy.auditRetentionDays === null
      ? "Aktivitätsprotokoll: unbegrenzt"
      : `Aktivitätsprotokoll: ${policy.auditRetentionDays} Tage`;
  return `${audit} · Papierkorb: ${policy.trashRetentionDays} Tage`;
}

export function RetentionForm({
  value,
  onChange,
  disabled = false,
}: {
  value: RetentionPolicy;
  onChange: (next: RetentionPolicy) => void;
  disabled?: boolean;
}) {
  const patch = (partial: Partial<RetentionPolicy>) => onChange({ ...value, ...partial });
  // A stored value that is not one of the presets keeps the custom input open,
  // so re-opening the page never silently rounds the admin's number to a preset.
  const days = value.auditRetentionDays;
  // Picking "Andere Frist …" has to stick even while the number still matches a
  // preset — derived from the value alone, choosing it from "1 Jahr" or
  // "Unbegrenzt" snapped straight back to "1 Jahr" and the input never opened.
  const [customChosen, setCustomChosen] = useState(false);
  const preset =
    days === null
      ? "unlimited"
      : !customChosen && AUDIT_PRESETS.some((option) => option.days === days)
        ? String(days)
        : "custom";

  return (
    <div className="space-y-6">
      <Field>
        <FieldLabel htmlFor="audit-retention">Aktivitätsprotokoll</FieldLabel>
        <NativeSelect
          id="audit-retention"
          className="w-full"
          disabled={disabled}
          value={preset}
          onChange={(event) => {
            const next = event.target.value;
            setCustomChosen(next === "custom");
            if (next === "unlimited") return patch({ auditRetentionDays: null });
            if (next === "custom") return patch({ auditRetentionDays: days ?? 365 });
            patch({ auditRetentionDays: Number(next) });
          }}
        >
          {AUDIT_PRESETS.map((option) => (
            <NativeSelectOption key={option.value} value={option.value}>
              {option.label}
            </NativeSelectOption>
          ))}
        </NativeSelect>
        <FieldDescription>
          Das Protokoll ist der Nachweis, wer was geändert hat. Unbegrenzt ist die Voreinstellung —
          eine Frist löscht diesen Nachweis nach Ablauf endgültig. Wer die Frist ändert, wird selbst
          protokolliert; dieser Eintrag bleibt immer erhalten.
        </FieldDescription>
      </Field>

      {preset === "custom" ? (
        <Field>
          <FieldLabel htmlFor="audit-retention-days">Frist in Tagen</FieldLabel>
          <CustomDaysInput
            value={days ?? MIN_DAYS}
            disabled={disabled}
            onChange={(next) => patch({ auditRetentionDays: next })}
          />
          <FieldDescription>
            Zwischen {MIN_DAYS} und {MAX_DAYS} Tagen (10 Jahre).
          </FieldDescription>
        </Field>
      ) : null}

      <Field>
        <FieldLabel htmlFor="trash-retention">Papierkorb</FieldLabel>
        <NativeSelect
          id="trash-retention"
          className="w-full"
          disabled={disabled}
          value={String(value.trashRetentionDays)}
          onChange={(event) => patch({ trashRetentionDays: Number(event.target.value) })}
        >
          {(TRASH_PRESETS.includes(value.trashRetentionDays)
            ? TRASH_PRESETS
            : [value.trashRetentionDays, ...TRASH_PRESETS].sort((a, b) => a - b)
          ).map((option) => (
            <NativeSelectOption key={option} value={String(option)}>
              {option} Tage
            </NativeSelectOption>
          ))}
        </NativeSelect>
        <FieldDescription>
          So lange bleiben gelöschte Seiten und Bereiche wiederherstellbar. Danach werden sie samt
          Anhängen endgültig entfernt. Objekte mit Löschsperre bleiben davon unberührt.
        </FieldDescription>
      </Field>
    </div>
  );
}

/**
 * The free-form day count. Typing goes into a local draft so the field can be
 * cleared and retyped — clamping every keystroke turned an emptied field into
 * "1" under the cursor. Valid numbers still reach the policy immediately
 * (clamped, so the confirmation dialog counts against what gets saved); blur
 * snaps the draft back to the stored value.
 */
function CustomDaysInput({
  value,
  disabled,
  onChange,
}: {
  value: number;
  disabled: boolean;
  onChange: (next: number) => void;
}) {
  const [draft, setDraft] = useState<string | null>(null);

  return (
    <Input
      id="audit-retention-days"
      type="number"
      inputMode="numeric"
      min={MIN_DAYS}
      max={MAX_DAYS}
      className="w-40"
      disabled={disabled}
      value={draft ?? String(value)}
      onChange={(event) => {
        setDraft(event.target.value);
        const parsed = Number(event.target.value);
        if (event.target.value !== "" && Number.isFinite(parsed)) {
          onChange(Math.min(MAX_DAYS, Math.max(MIN_DAYS, Math.trunc(parsed))));
        }
      }}
      onBlur={() => setDraft(null)}
    />
  );
}
