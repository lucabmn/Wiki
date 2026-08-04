import { actionMail, isMailConfigured, sendMail } from "@nilovon-wiki/auth/mail";
import { env } from "@nilovon-wiki/env/server";

import type { MemberCompliance } from "./two-factor-policy";

/** Berlin-style date the deadline is written as in the mail and the UI banner. */
const DEADLINE_FORMAT = new Intl.DateTimeFormat("de-DE", {
  dateStyle: "long",
  timeStyle: "short",
});

export function formatDeadline(deadline: Date): string {
  return DEADLINE_FORMAT.format(deadline);
}

/**
 * Tells the members a freshly enabled requirement will lock out that they need
 * to act, and by when. Sent only to those actually affected: mailing compliant
 * members a warning they cannot act on trains everyone to ignore the next one.
 *
 * Failures are swallowed per recipient (`sendMail` logs them). A bounced
 * warning must not roll back the policy the admin just saved — the policy is
 * the security control, the mail is the courtesy.
 */
export async function sendTwoFactorPolicyMails(input: {
  members: MemberCompliance[];
  organizationName: string;
  graceUntil: Date | null;
}): Promise<number> {
  if (!isMailConfigured() || input.members.length === 0) return 0;

  const url = new URL("/settings/security", env.CORS_ORIGIN).toString();
  const deadline = input.graceUntil
    ? `Du hast bis zum ${formatDeadline(input.graceUntil)} Zeit.`
    : "Die Pflicht gilt ab sofort — ohne zweiten Faktor kommst du nicht mehr an die Inhalte.";

  await Promise.all(
    input.members.map((member) =>
      sendMail({
        to: member.email,
        subject: `${input.organizationName}: Zwei-Faktor-Authentifizierung wird Pflicht`,
        ...actionMail({
          heading: "Zweiten Faktor einrichten",
          body:
            `${input.organizationName} verlangt ab sofort eine Zwei-Faktor-Authentifizierung. ` +
            `${deadline} Richte dafür eine Authenticator-App oder einen Passkey ein — beides zählt.`,
          actionLabel: "Jetzt einrichten",
          url,
        }),
      }),
    ),
  );

  return input.members.length;
}
