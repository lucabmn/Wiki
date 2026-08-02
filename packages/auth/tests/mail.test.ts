import net from "node:net";
import { afterEach, describe, expect, it, vi } from "vitest";

import { actionMail } from "../src/mail";

/**
 * The env package validates `process.env` once at module load, so stubbing a
 * variable after the fact would not reach it. Re-import the module graph per
 * case instead — that is also what an operator's restart does.
 */
async function loadMailer(overrides: Record<string, string>) {
  for (const [key, value] of Object.entries(overrides)) vi.stubEnv(key, value);
  vi.resetModules();
  return import("../src/mail");
}

/**
 * A throwaway SMTP sink. Exercising the real nodemailer transport over a real
 * socket is the point: a mocked transport would still pass if the message never
 * became valid SMTP, which is exactly the failure mode that leaves invitations
 * silently undelivered.
 */
function startSink() {
  const received: string[] = [];
  const server = net.createServer((socket) => {
    let inData = false;
    let body = "";
    socket.write("220 localhost ESMTP sink\r\n");
    socket.on("data", (chunk) => {
      const text = chunk.toString();
      if (inData) {
        body += text;
        if (body.includes("\r\n.\r\n")) {
          inData = false;
          received.push(body);
          socket.write("250 2.0.0 Ok: queued\r\n");
        }
        return;
      }
      for (const line of text.split("\r\n").filter(Boolean)) {
        const verb = line.split(" ")[0]?.toUpperCase();
        if (verb === "EHLO" || verb === "HELO") socket.write("250-localhost\r\n250 8BITMIME\r\n");
        else if (verb === "MAIL" || verb === "RCPT") socket.write("250 2.1.0 Ok\r\n");
        else if (verb === "DATA") {
          inData = true;
          socket.write("354 End data with <CR><LF>.<CR><LF>\r\n");
        } else if (verb === "QUIT") {
          socket.write("221 2.0.0 Bye\r\n");
          socket.end();
        } else socket.write("250 2.0.0 Ok\r\n");
      }
    });
    socket.on("error", () => {});
  });
  return {
    received,
    listen: () =>
      new Promise<number>((resolve) => {
        server.listen(0, "127.0.0.1", () => {
          resolve((server.address() as net.AddressInfo).port);
        });
      }),
    close: () => new Promise<void>((resolve) => server.close(() => resolve())),
  };
}

const invitation = () =>
  actionMail({
    heading: "Einladung zu Acme",
    body: "Luca hat dich eingeladen.",
    actionLabel: "Einladung annehmen",
    url: "http://localhost:3001/accept-invitation/inv_123",
  });

describe("actionMail", () => {
  it("puts the action URL in both the text and the HTML part", () => {
    const mail = invitation();
    expect(mail.text).toContain("http://localhost:3001/accept-invitation/inv_123");
    expect(mail.html).toContain("http://localhost:3001/accept-invitation/inv_123");
  });

  it("escapes markup so an organization name cannot inject HTML", () => {
    const mail = actionMail({
      heading: '<script>alert("x")</script>',
      body: "b",
      actionLabel: "a",
      url: "http://localhost/?a=1&b=2",
    });
    expect(mail.html).not.toContain("<script>");
    expect(mail.html).toContain("&lt;script&gt;");
    expect(mail.html).toContain("a=1&amp;b=2");
  });
});

describe("sendMail", () => {
  afterEach(() => vi.unstubAllEnvs());

  it("delivers a well-formed message over SMTP", async () => {
    const sink = startSink();
    const port = await sink.listen();
    const { sendMail } = await loadMailer({ SMTP_HOST: "127.0.0.1", SMTP_PORT: String(port) });

    await sendMail({
      to: "invitee@example.test",
      subject: "Einladung zu Acme",
      ...invitation(),
    });
    await sink.close();

    const raw = sink.received[0];
    expect(raw).toBeDefined();
    expect(raw).toContain("invitee@example.test");
    expect(raw).toContain("wiki@example.test");
    // The link survives quoted-printable/base64 encoding of the body only if we
    // look for the id; the full URL may be soft-wrapped.
    expect(raw).toContain("inv_123");
  });

  it("logs instead of throwing when SMTP is not configured", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const { sendMail } = await loadMailer({ SMTP_HOST: "" });

    await expect(
      sendMail({ to: "a@example.test", subject: "s", ...invitation() }),
    ).resolves.toBeUndefined();
    expect(warn).toHaveBeenCalled();
    expect(warn.mock.calls[0]?.[0]).toContain("inv_123");
    warn.mockRestore();
  });

  it("swallows a transport failure so a bounced mail cannot fail the request", async () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    // Nothing listens on this port, so the connection is refused.
    const { sendMail } = await loadMailer({ SMTP_HOST: "127.0.0.1", SMTP_PORT: "1" });

    await expect(
      sendMail({ to: "a@example.test", subject: "s", ...invitation() }),
    ).resolves.toBeUndefined();
    expect(error).toHaveBeenCalled();
    error.mockRestore();
  });
});
