import { useEffect, useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { PermissionRequest } from "@nilovon-wiki/auth/permissions";
import { toast } from "sonner";

import { orpc } from "@/utils/orpc";
import { toastError } from "@/lib/query";
import { GRACE_PRESETS, graceDeadline } from "@/lib/two-factor";
import { PermissionGate } from "@/components/settings/permission-gate";
import { SettingsCard, SettingsSection } from "@/components/settings/settings-section";
import { AffectedMembers } from "@/components/security/affected-members";
import { Button } from "@nilovon-wiki/ui/components/button";
import { Field, FieldDescription, FieldLabel } from "@nilovon-wiki/ui/components/field";
import { Input } from "@nilovon-wiki/ui/components/input";
import { Skeleton } from "@nilovon-wiki/ui/components/skeleton";
import { Switch } from "@nilovon-wiki/ui/components/switch";

const ORG_UPDATE: PermissionRequest[] = [{ organization: ["update"] }];

export const Route = createFileRoute("/_auth/settings/security-policy")({
  component: () => (
    <PermissionGate permissions={ORG_UPDATE}>
      <SecurityPolicySettings />
    </PermissionGate>
  ),
});

type Draft = {
  twoFactorRequired: boolean;
  twoFactorGraceUntil: Date | null;
  twoFactorRequireForSso: boolean;
};

function SecurityPolicySettings() {
  const queryClient = useQueryClient();
  const overview = useQuery(orpc.securityPolicy.getTwoFactorPolicy.queryOptions({ input: {} }));
  const [draft, setDraft] = useState<Draft | null>(null);

  // Seed once the server value lands, and again if it changes underneath us.
  useEffect(() => {
    if (!overview.data) return;
    const { twoFactorRequired, twoFactorGraceUntil, twoFactorRequireForSso } = overview.data.policy;
    setDraft({
      twoFactorRequired,
      twoFactorGraceUntil: twoFactorGraceUntil ? new Date(twoFactorGraceUntil) : null,
      twoFactorRequireForSso,
    });
  }, [overview.data]);

  const save = useMutation(
    orpc.securityPolicy.updateTwoFactorPolicy.mutationOptions({
      onSuccess: async (_data, variables) => {
        // The gate and its banner read the caller's own status from the same
        // router, so an admin who just locked themselves out sees it at once.
        await queryClient.invalidateQueries({ queryKey: orpc.securityPolicy.key() });
        toast.success(
          variables.twoFactorRequired ? "Zwei-Faktor-Pflicht aktiv" : "Zwei-Faktor-Pflicht aus",
        );
      },
      onError: toastError,
    }),
  );

  if (overview.isPending || !draft || !overview.data) {
    return (
      <div className="space-y-3">
        <Skeleton className="h-5 w-56" />
        <Skeleton className="h-72 w-full rounded-xl" />
      </div>
    );
  }

  const { policy, memberCount, nonCompliant, mailConfigured } = overview.data;
  const patch = (values: Partial<Draft>) => setDraft({ ...draft, ...values });

  const dirty =
    draft.twoFactorRequired !== policy.twoFactorRequired ||
    draft.twoFactorRequireForSso !== policy.twoFactorRequireForSso ||
    (draft.twoFactorGraceUntil?.getTime() ?? null) !==
      (policy.twoFactorGraceUntil ? new Date(policy.twoFactorGraceUntil).getTime() : null);

  return (
    <div className="space-y-8">
      <SettingsSection
        title="Zwei-Faktor-Authentifizierung"
        description="Verpflichte alle Mitglieder dieser Organisation auf einen zweiten Faktor. Eine Authenticator-App und ein Passkey zählen beide."
      >
        <SettingsCard>
          <form
            className="space-y-6"
            onSubmit={(event) => {
              event.preventDefault();
              if (dirty && !save.isPending) save.mutate(draft);
            }}
          >
            <ToggleRow
              id="two-factor-required"
              label="Zweiten Faktor verlangen"
              description="Ohne zweiten Faktor kommt niemand mehr an die Inhalte — nach Ablauf der unten gesetzten Frist."
              checked={draft.twoFactorRequired}
              disabled={save.isPending}
              onChange={(twoFactorRequired) => patch({ twoFactorRequired })}
            />

            {draft.twoFactorRequired ? (
              <>
                <GraceField
                  value={draft.twoFactorGraceUntil}
                  disabled={save.isPending}
                  onChange={(twoFactorGraceUntil) => patch({ twoFactorGraceUntil })}
                />
                <ToggleRow
                  id="two-factor-sso"
                  label="Auch für SSO-Konten erzwingen"
                  description="Aus: wer sich über einen Identity-Provider anmeldet, ist ausgenommen — der zweite Faktor liegt dann dort. An: auch diese Konten brauchen zusätzlich eine App oder einen Passkey."
                  checked={draft.twoFactorRequireForSso}
                  disabled={save.isPending}
                  onChange={(twoFactorRequireForSso) => patch({ twoFactorRequireForSso })}
                />
              </>
            ) : null}

            <AffectedMembers
              memberCount={memberCount}
              nonCompliant={nonCompliant}
              requireForSso={draft.twoFactorRequireForSso}
              willEnforce={draft.twoFactorRequired}
              graceUntil={draft.twoFactorGraceUntil}
              mailConfigured={mailConfigured}
            />

            <div className="flex justify-end border-t border-border pt-4">
              <Button type="submit" size="sm" disabled={!dirty || save.isPending}>
                {save.isPending ? "Speichern …" : "Speichern"}
              </Button>
            </div>
          </form>
        </SettingsCard>
      </SettingsSection>
    </div>
  );
}

function ToggleRow({
  id,
  label,
  description,
  checked,
  disabled,
  onChange,
}: {
  id: string;
  label: string;
  description: string;
  checked: boolean;
  disabled: boolean;
  onChange: (next: boolean) => void;
}) {
  return (
    <div className="flex items-start justify-between gap-4">
      <label htmlFor={id} className="min-w-0 cursor-pointer">
        <span className="block text-sm font-medium">{label}</span>
        <span className="block text-xs text-muted-foreground">{description}</span>
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

/** `datetime-local` wants a local-time string without a zone suffix. */
function toLocalInput(value: Date): string {
  const offset = value.getTimezoneOffset() * 60_000;
  return new Date(value.getTime() - offset).toISOString().slice(0, 16);
}

function GraceField({
  value,
  disabled,
  onChange,
}: {
  value: Date | null;
  disabled: boolean;
  onChange: (next: Date | null) => void;
}) {
  return (
    <Field>
      <FieldLabel htmlFor="two-factor-grace">Frist</FieldLabel>
      <div className="flex flex-wrap items-center gap-2">
        {GRACE_PRESETS.map((preset) => (
          <Button
            key={preset.label}
            type="button"
            size="sm"
            variant="outline"
            disabled={disabled}
            onClick={() => onChange(graceDeadline(preset.days))}
          >
            {preset.label}
          </Button>
        ))}
        <Input
          id="two-factor-grace"
          type="datetime-local"
          className="w-auto"
          disabled={disabled}
          value={value ? toLocalInput(value) : ""}
          onChange={(event) => {
            const next = event.target.value;
            onChange(next ? new Date(next) : null);
          }}
        />
      </div>
      <FieldDescription>
        Bis dahin sehen betroffene Mitglieder nur einen Hinweis mit Countdown. Ohne Frist greift die
        Sperre sofort.
      </FieldDescription>
    </Field>
  );
}
