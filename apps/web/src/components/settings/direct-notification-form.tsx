import { AtSign, MessageSquareReply } from "lucide-react";

import {
  Field,
  FieldContent,
  FieldDescription,
  FieldLabel,
} from "@nilovon-wiki/ui/components/field";
import { Switch } from "@nilovon-wiki/ui/components/switch";

/**
 * The two switches for directed notifications, shared by the admin defaults tab
 * and the personal one — both edit exactly the same shape, so this is a plain
 * controlled component that knows nothing about who is editing or how it saves.
 */

export type DirectNotificationPreferences = {
  mentions: boolean;
  commentReplies: boolean;
};

const OPTIONS: {
  key: keyof DirectNotificationPreferences;
  icon: typeof AtSign;
  label: string;
  hint: string;
}[] = [
  {
    key: "mentions",
    icon: AtSign,
    label: "Erwähnungen",
    hint: "Jemand schreibt @deinen Namen auf einer Seite oder in einem Kommentar.",
  },
  {
    key: "commentReplies",
    icon: MessageSquareReply,
    label: "Antworten auf meine Kommentare",
    hint: "Jemand antwortet direkt auf einen Kommentar von dir.",
  },
];

export function DirectNotificationForm({
  idPrefix,
  value,
  onChange,
  disabled = false,
}: {
  /** Distinguishes the field ids when two of these forms are on one page. */
  idPrefix: string;
  value: DirectNotificationPreferences;
  onChange: (next: DirectNotificationPreferences) => void;
  disabled?: boolean;
}) {
  return (
    <div className="space-y-4">
      {OPTIONS.map((option) => (
        <Field key={option.key} orientation="horizontal">
          <FieldContent>
            <FieldLabel htmlFor={`${idPrefix}-${option.key}`} className="font-medium">
              <option.icon className="size-4 text-muted-foreground" aria-hidden />
              {option.label}
            </FieldLabel>
            <FieldDescription>{option.hint}</FieldDescription>
          </FieldContent>
          <Switch
            className="mt-1 shrink-0"
            id={`${idPrefix}-${option.key}`}
            checked={value[option.key]}
            disabled={disabled}
            onCheckedChange={(checked) => onChange({ ...value, [option.key]: checked })}
          />
        </Field>
      ))}
    </div>
  );
}
