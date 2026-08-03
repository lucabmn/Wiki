import { Checkbox } from "@nilovon-wiki/ui/components/checkbox";
import { Field, FieldDescription, FieldLabel } from "@nilovon-wiki/ui/components/field";
import { NativeSelect, NativeSelectOption } from "@nilovon-wiki/ui/components/native-select";
import { Switch } from "@nilovon-wiki/ui/components/switch";

/**
 * The schedule + content picker for bundled notifications, shared by the admin
 * defaults tab and the personal one. Both edit exactly the same shape, so the
 * form is a controlled component over `DigestPreferences` and knows nothing
 * about who is editing or how it gets saved.
 */

export type DigestFrequency = "off" | "daily" | "weekly" | "monthly";
export type DigestScope = "organization" | "my_spaces" | "subscribed";
export type DigestCategory =
  | "pages_created"
  | "pages_updated"
  | "pages_removed"
  | "comments"
  | "attachments"
  | "spaces";

export type DigestPreferences = {
  frequency: DigestFrequency;
  hour: number;
  weekday: number;
  dayOfMonth: number;
  timezone: string;
  categories: DigestCategory[];
  scope: DigestScope;
  skipIfEmpty: boolean;
  includeOwnActivity: boolean;
};

const FREQUENCIES: { value: DigestFrequency; label: string }[] = [
  { value: "off", label: "Keine Zusammenfassung" },
  { value: "daily", label: "Täglich" },
  { value: "weekly", label: "Wöchentlich" },
  { value: "monthly", label: "Monatlich" },
];

const WEEKDAYS = [
  { value: 1, label: "Montag" },
  { value: 2, label: "Dienstag" },
  { value: 3, label: "Mittwoch" },
  { value: 4, label: "Donnerstag" },
  { value: 5, label: "Freitag" },
  { value: 6, label: "Samstag" },
  { value: 0, label: "Sonntag" },
];

const SCOPES: { value: DigestScope; label: string; hint: string }[] = [
  {
    value: "organization",
    label: "Ganze Organisation",
    hint: "Alles, was du lesen darfst.",
  },
  {
    value: "my_spaces",
    label: "Nur meine Bereiche",
    hint: "Bereiche, in denen du ausdrücklich Mitglied bist.",
  },
  {
    value: "subscribed",
    label: "Nur abonnierte Seiten",
    hint: "Seiten, die du beobachtest oder favorisiert hast.",
  },
];

const CATEGORIES: { value: DigestCategory; label: string; hint: string }[] = [
  {
    value: "pages_created",
    label: "Neue Seiten",
    hint: "Angelegt oder veröffentlicht — Entwürfe erscheinen erst mit der Veröffentlichung",
  },
  {
    value: "pages_updated",
    label: "Geänderte Seiten",
    hint: "Bearbeitet, verschoben oder wiederhergestellt",
  },
  { value: "pages_removed", label: "Archiviert & gelöscht", hint: "Seiten, die verschwunden sind" },
  { value: "comments", label: "Kommentare", hint: "Neue, aufgelöste und gelöschte Kommentare" },
  { value: "attachments", label: "Anhänge", hint: "Hoch- und entfernte Dateien" },
  { value: "spaces", label: "Bereiche", hint: "Änderungen an Bereichen selbst" },
];

/**
 * Time zones the browser knows, if it exposes the list. Falls back to a short
 * list plus whatever is already stored, so the current value is always
 * selectable even on a runtime without `supportedValuesOf`.
 */
function timezoneOptions(current: string): string[] {
  const supported =
    typeof Intl.supportedValuesOf === "function"
      ? Intl.supportedValuesOf("timeZone")
      : ["UTC", "Europe/Berlin", "Europe/Vienna", "Europe/Zurich", "Europe/London"];
  return supported.includes(current) ? supported : [current, ...supported];
}

const HOURS = Array.from({ length: 24 }, (_, hour) => hour);

export function DigestForm({
  value,
  onChange,
  disabled = false,
  idPrefix,
}: {
  value: DigestPreferences;
  onChange: (next: DigestPreferences) => void;
  disabled?: boolean;
  /** Keeps label/control ids unique when two forms share a page. */
  idPrefix: string;
}) {
  const patch = (partial: Partial<DigestPreferences>) => onChange({ ...value, ...partial });
  const off = value.frequency === "off";

  return (
    <div className="space-y-6">
      <div className="grid gap-4 sm:grid-cols-2">
        <Field>
          <FieldLabel htmlFor={`${idPrefix}-frequency`}>Rhythmus</FieldLabel>
          <NativeSelect
            id={`${idPrefix}-frequency`}
            className="w-full"
            disabled={disabled}
            value={value.frequency}
            onChange={(event) => patch({ frequency: event.target.value as DigestFrequency })}
          >
            {FREQUENCIES.map((option) => (
              <NativeSelectOption key={option.value} value={option.value}>
                {option.label}
              </NativeSelectOption>
            ))}
          </NativeSelect>
        </Field>

        {/* Hidden rather than disabled when off: an inert row of time pickers
            reads as broken, and there is nothing to schedule. */}
        {off ? null : (
          <Field>
            <FieldLabel htmlFor={`${idPrefix}-hour`}>Uhrzeit</FieldLabel>
            <NativeSelect
              id={`${idPrefix}-hour`}
              className="w-full"
              disabled={disabled}
              value={String(value.hour)}
              onChange={(event) => patch({ hour: Number(event.target.value) })}
            >
              {HOURS.map((hour) => (
                <NativeSelectOption key={hour} value={String(hour)}>
                  {String(hour).padStart(2, "0")}:00
                </NativeSelectOption>
              ))}
            </NativeSelect>
          </Field>
        )}

        {value.frequency === "weekly" ? (
          <Field>
            <FieldLabel htmlFor={`${idPrefix}-weekday`}>Wochentag</FieldLabel>
            <NativeSelect
              id={`${idPrefix}-weekday`}
              className="w-full"
              disabled={disabled}
              value={String(value.weekday)}
              onChange={(event) => patch({ weekday: Number(event.target.value) })}
            >
              {WEEKDAYS.map((day) => (
                <NativeSelectOption key={day.value} value={String(day.value)}>
                  {day.label}
                </NativeSelectOption>
              ))}
            </NativeSelect>
          </Field>
        ) : null}

        {value.frequency === "monthly" ? (
          <Field>
            <FieldLabel htmlFor={`${idPrefix}-day`}>Tag im Monat</FieldLabel>
            <NativeSelect
              id={`${idPrefix}-day`}
              className="w-full"
              disabled={disabled}
              value={String(value.dayOfMonth)}
              onChange={(event) => patch({ dayOfMonth: Number(event.target.value) })}
            >
              {Array.from({ length: 28 }, (_, index) => index + 1).map((day) => (
                <NativeSelectOption key={day} value={String(day)}>
                  {day}.
                </NativeSelectOption>
              ))}
            </NativeSelect>
            <FieldDescription>
              Höchstens der 28., damit kein Monat übersprungen wird.
            </FieldDescription>
          </Field>
        ) : null}

        {off ? null : (
          <Field>
            <FieldLabel htmlFor={`${idPrefix}-timezone`}>Zeitzone</FieldLabel>
            <NativeSelect
              id={`${idPrefix}-timezone`}
              className="w-full"
              disabled={disabled}
              value={value.timezone}
              onChange={(event) => patch({ timezone: event.target.value })}
            >
              {timezoneOptions(value.timezone).map((zone) => (
                <NativeSelectOption key={zone} value={zone}>
                  {zone}
                </NativeSelectOption>
              ))}
            </NativeSelect>
            <FieldDescription>Uhrzeit und Wochentag gelten in dieser Zeitzone.</FieldDescription>
          </Field>
        )}
      </div>

      {off ? null : (
        <>
          <Field>
            <FieldLabel htmlFor={`${idPrefix}-scope`}>Umfang</FieldLabel>
            <NativeSelect
              id={`${idPrefix}-scope`}
              className="w-full sm:w-72"
              disabled={disabled}
              value={value.scope}
              onChange={(event) => patch({ scope: event.target.value as DigestScope })}
            >
              {SCOPES.map((option) => (
                <NativeSelectOption key={option.value} value={option.value}>
                  {option.label}
                </NativeSelectOption>
              ))}
            </NativeSelect>
            <FieldDescription>
              {SCOPES.find((option) => option.value === value.scope)?.hint}
            </FieldDescription>
          </Field>

          <fieldset className="space-y-2" disabled={disabled}>
            <legend className="text-sm font-medium">Inhalte</legend>
            <p className="text-sm text-muted-foreground">
              Ohne Auswahl wird keine Zusammenfassung verschickt.
            </p>
            <div className="grid gap-2 sm:grid-cols-2">
              {CATEGORIES.map((category) => {
                const checked = value.categories.includes(category.value);
                return (
                  <label
                    key={category.value}
                    htmlFor={`${idPrefix}-cat-${category.value}`}
                    className="flex cursor-pointer items-start gap-2 rounded-lg border border-border p-2.5 text-sm"
                  >
                    <Checkbox
                      id={`${idPrefix}-cat-${category.value}`}
                      className="mt-0.5"
                      checked={checked}
                      disabled={disabled}
                      onCheckedChange={(next) =>
                        patch({
                          categories:
                            next === true
                              ? [...value.categories, category.value]
                              : value.categories.filter((entry) => entry !== category.value),
                        })
                      }
                    />
                    <span className="min-w-0">
                      <span className="block font-medium">{category.label}</span>
                      <span className="block text-xs text-muted-foreground">{category.hint}</span>
                    </span>
                  </label>
                );
              })}
            </div>
          </fieldset>

          <div className="space-y-3">
            <ToggleRow
              id={`${idPrefix}-skip-empty`}
              label="Keine Mail bei leerer Zusammenfassung"
              hint="Empfohlen — sonst kommt die Mail auch, wenn nichts passiert ist."
              checked={value.skipIfEmpty}
              disabled={disabled}
              onChange={(next) => patch({ skipIfEmpty: next })}
            />
            <ToggleRow
              id={`${idPrefix}-own`}
              label="Eigene Änderungen einbeziehen"
              hint="Standardmäßig aus — du weißt, was du selbst geändert hast."
              checked={value.includeOwnActivity}
              disabled={disabled}
              onChange={(next) => patch({ includeOwnActivity: next })}
            />
          </div>
        </>
      )}
    </div>
  );
}

function ToggleRow({
  id,
  label,
  hint,
  checked,
  disabled,
  onChange,
}: {
  id: string;
  label: string;
  hint: string;
  checked: boolean;
  disabled: boolean;
  onChange: (next: boolean) => void;
}) {
  return (
    <div className="flex items-start justify-between gap-4">
      <label htmlFor={id} className="min-w-0 cursor-pointer">
        <span className="block text-sm font-medium">{label}</span>
        <span className="block text-xs text-muted-foreground">{hint}</span>
      </label>
      <Switch
        id={id}
        className="mt-1 shrink-0"
        checked={checked}
        disabled={disabled}
        onCheckedChange={(next) => onChange(Boolean(next))}
      />
    </div>
  );
}

/** Human-readable summary of a schedule, for the "you are inheriting X" line. */
export function describeSchedule(preferences: DigestPreferences): string {
  if (preferences.frequency === "off") return "Keine Zusammenfassung";
  const time = `${String(preferences.hour).padStart(2, "0")}:00 (${preferences.timezone})`;
  switch (preferences.frequency) {
    case "daily":
      return `Täglich um ${time}`;
    case "weekly": {
      const weekday = WEEKDAYS.find((day) => day.value === preferences.weekday)?.label ?? "Montag";
      return `Jeden ${weekday} um ${time}`;
    }
    case "monthly":
      return `Am ${preferences.dayOfMonth}. jedes Monats um ${time}`;
  }
}

export { CATEGORIES as DIGEST_CATEGORY_OPTIONS, SCOPES as DIGEST_SCOPE_OPTIONS };
