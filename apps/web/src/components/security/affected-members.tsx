import { CheckCircle2, MailWarning, ShieldAlert } from "lucide-react";

import { formatDateTime } from "@/lib/format";
import { Badge } from "@nilovon-wiki/ui/components/badge";

type Member = {
  userId: string;
  name: string;
  email: string;
  isSsoAccount: boolean;
};

/** Beyond this the list becomes a wall of names and stops being read. */
const VISIBLE = 8;

/**
 * The consequences of the form as it currently stands — "these 12 people lose
 * access on 4. August". This is the number that decides whether the switch ever
 * gets flipped, so it previews the *unsaved* draft rather than what is stored.
 */
export function AffectedMembers({
  memberCount,
  nonCompliant,
  requireForSso,
  willEnforce,
  graceUntil,
  mailConfigured,
}: {
  memberCount: number;
  nonCompliant: Member[];
  requireForSso: boolean;
  willEnforce: boolean;
  graceUntil: Date | null;
  mailConfigured: boolean;
}) {
  const affected = nonCompliant.filter((member) => requireForSso || !member.isSsoAccount);
  const ssoExempt = requireForSso ? 0 : nonCompliant.length - affected.length;
  const compliant = memberCount - nonCompliant.length;

  return (
    <div className="space-y-3 border-t border-border pt-4">
      <div className="flex items-start gap-2 text-sm">
        {affected.length === 0 ? (
          <CheckCircle2 className="mt-0.5 size-4 shrink-0 text-emerald-600" />
        ) : (
          <ShieldAlert className="mt-0.5 size-4 shrink-0 text-amber-600" />
        )}
        <p className="min-w-0">
          <span className="font-medium">
            {compliant} von {memberCount} {memberCount === 1 ? "Mitglied hat" : "Mitgliedern haben"}{" "}
            einen zweiten Faktor.
          </span>{" "}
          <span className="text-muted-foreground">
            {affected.length === 0
              ? "Die Pflicht sperrt niemanden aus."
              : willEnforce
                ? `${affected.length} ${affected.length === 1 ? "Person verliert" : "Personen verlieren"} den Zugriff${graceUntil ? ` am ${formatDateTime(graceUntil)}` : " sofort"}.`
                : `${affected.length} ${affected.length === 1 ? "Person würde" : "Personen würden"} beim Einschalten ausgesperrt.`}
          </span>
        </p>
      </div>

      {ssoExempt > 0 ? (
        <p className="text-xs text-muted-foreground">
          Zusätzlich {ssoExempt} {ssoExempt === 1 ? "Konto ist" : "Konten sind"} über die
          SSO-Ausnahme geschützt — der zweite Faktor liegt beim Identity-Provider.
        </p>
      ) : null}

      {affected.length > 0 ? (
        <ul className="space-y-1">
          {affected.slice(0, VISIBLE).map((member) => (
            <li
              key={member.userId}
              className="flex flex-wrap items-center gap-2 text-sm text-muted-foreground"
            >
              <span className="font-medium text-foreground">{member.name}</span>
              <span className="min-w-0 truncate">{member.email}</span>
              {member.isSsoAccount ? (
                <Badge variant="outline" className="shrink-0">
                  SSO
                </Badge>
              ) : null}
            </li>
          ))}
          {affected.length > VISIBLE ? (
            <li className="text-sm text-muted-foreground">
              … und {affected.length - VISIBLE} weitere
            </li>
          ) : null}
        </ul>
      ) : null}

      {willEnforce && !mailConfigured && affected.length > 0 ? (
        <p className="flex items-start gap-2 text-xs text-amber-700 dark:text-amber-300">
          <MailWarning className="mt-0.5 size-3.5 shrink-0" />
          Ohne konfiguriertes SMTP geht keine Vorwarnung raus — die Betroffenen erfahren erst beim
          nächsten Login davon.
        </p>
      ) : null}
    </div>
  );
}
