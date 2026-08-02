import { Check, Copy } from "lucide-react";
import { useEffect, useId, useState } from "react";
import { toast } from "sonner";

import { Button } from "@nilovon-wiki/ui/components/button";
import { Field, FieldDescription, FieldLabel } from "@nilovon-wiki/ui/components/field";
import { cn } from "@nilovon-wiki/ui/lib/utils";

/**
 * A value the operator has to carry into someone else's console — a redirect
 * URI, a DNS record, a bearer token.
 *
 * Transcribing those by hand is where SSO setups break, so the value is
 * selectable, wraps instead of truncating (a half-shown URL cannot be checked
 * against the identity provider), and copying acknowledges itself on the button
 * rather than only in a toast that may be off-screen.
 */
export function CopyField({
  label,
  value,
  description,
  className,
}: {
  label: string;
  value: string;
  description?: string;
  className?: string;
}) {
  const id = useId();
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    if (!copied) return;
    const timer = setTimeout(() => setCopied(false), 2000);
    return () => clearTimeout(timer);
  }, [copied]);

  const onCopy = async () => {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(true);
    } catch {
      // Clipboard access needs a secure context, which a plain-HTTP LAN install
      // does not have. The value is selectable, so say so instead of failing mute.
      toast.error("Kopieren nicht möglich — bitte den Wert markieren und kopieren.");
    }
  };

  return (
    <Field className={className}>
      <FieldLabel htmlFor={id}>{label}</FieldLabel>
      <div className="flex items-start gap-2">
        <output
          id={id}
          className="min-w-0 flex-1 rounded-md border border-border bg-muted/40 px-3 py-2 font-mono text-xs break-all select-all"
        >
          {value}
        </output>
        <Button
          type="button"
          variant="outline"
          size="icon"
          onClick={onCopy}
          aria-label={`${label} kopieren`}
        >
          {copied ? (
            <Check className={cn("size-4", "text-emerald-600 dark:text-emerald-400")} />
          ) : (
            <Copy className="size-4" />
          )}
        </Button>
      </div>
      {description ? <FieldDescription>{description}</FieldDescription> : null}
    </Field>
  );
}
