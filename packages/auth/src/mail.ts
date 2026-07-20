import { env } from "@nilovon-wiki/env/server";
import { createTransport, type Transporter } from "nodemailer";

/**
 * SMTP mail transport for the transactional mails Better Auth triggers
 * (invitations, password resets, address verification).
 *
 * SMTP is optional on purpose: a single-user self-host has no mail server, and
 * refusing to boot without one would be hostile. With `SMTP_HOST` unset the
 * transport degrades to logging the mail — including the action link — so an
 * operator can still complete a flow by copying the URL out of `docker compose
 * logs server`. Everything that *needs* delivery says so in the log line.
 */

let transporter: Transporter | null | undefined;

/** Lazily built so an unconfigured install never opens a connection. */
function getTransporter(): Transporter | null {
  if (transporter !== undefined) return transporter;
  if (!env.SMTP_HOST) {
    transporter = null;
    return null;
  }
  transporter = createTransport({
    host: env.SMTP_HOST,
    port: env.SMTP_PORT,
    secure: env.SMTP_SECURE,
    // Anonymous relays (Mailpit in dev, an internal MTA in prod) take no
    // credentials; passing an empty auth object would make nodemailer try
    // AUTH and fail against them.
    auth:
      env.SMTP_USER && env.SMTP_PASSWORD
        ? { user: env.SMTP_USER, pass: env.SMTP_PASSWORD }
        : undefined,
  });
  return transporter;
}

/** Reset the memoized transport — for tests that swap the env. */
export function resetMailTransport() {
  transporter = undefined;
}

export type Mail = {
  to: string;
  subject: string;
  text: string;
  html: string;
};

export async function sendMail(mail: Mail): Promise<void> {
  const transport = getTransporter();
  if (!transport) {
    console.warn(
      `[mail] SMTP_HOST is not configured — not sending "${mail.subject}" to ${mail.to}.\n` +
        `${mail.text}`,
    );
    return;
  }
  try {
    await transport.sendMail({ from: env.SMTP_FROM, ...mail });
  } catch (error) {
    // Better Auth surfaces a thrown error to the caller as a failed request.
    // A bounced invitation must not roll back the invitation row, so log and
    // swallow: the operator sees the failure, the user sees a normal result.
    console.error(`[mail] failed to send "${mail.subject}" to ${mail.to}:`, error);
  }
}

/**
 * Minimal, client-agnostic HTML: a heading, a paragraph, a button-styled link
 * and the raw URL as a fallback for clients that strip anchors.
 */
export function actionMail({
  heading,
  body,
  actionLabel,
  url,
}: {
  heading: string;
  body: string;
  actionLabel: string;
  url: string;
}): { text: string; html: string } {
  return {
    text: `${heading}\n\n${body}\n\n${actionLabel}: ${url}\n`,
    html: `<!doctype html>
<html lang="de"><body style="margin:0;padding:24px;background:#f6f7f9;font-family:system-ui,-apple-system,'Segoe UI',sans-serif;color:#111">
  <table role="presentation" style="max-width:520px;margin:0 auto;background:#fff;border-radius:12px;padding:32px">
    <tr><td>
      <h1 style="margin:0 0 12px;font-size:20px;line-height:1.3">${escapeHtml(heading)}</h1>
      <p style="margin:0 0 24px;font-size:14px;line-height:1.6;color:#444">${escapeHtml(body)}</p>
      <a href="${escapeHtml(url)}" style="display:inline-block;background:#111;color:#fff;text-decoration:none;padding:10px 18px;border-radius:8px;font-size:14px;font-weight:600">${escapeHtml(actionLabel)}</a>
      <p style="margin:24px 0 0;font-size:12px;line-height:1.6;color:#777">Falls der Button nicht funktioniert, öffne diesen Link:<br><a href="${escapeHtml(url)}" style="color:#555">${escapeHtml(url)}</a></p>
    </td></tr>
  </table>
</body></html>`,
  };
}

function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}
