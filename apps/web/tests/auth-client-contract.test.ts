import { describe, expect, it } from "vitest";

import { authClient } from "@/lib/auth-client";

// The client's action surface is *derived* — partly from endpoint paths, partly
// from plugin atoms, and gated by the options each plugin is configured with
// (`teams: { enabled: true }` is what makes the team actions exist at all).
// TypeScript infers the same surface from the same options, so a wrong option
// typechecks and 404s at runtime. These assertions pin the real object.
describe("auth client action surface", () => {
  it("exposes the two-factor actions the security settings drive", () => {
    expect(typeof authClient.twoFactor.enable).toBe("function");
    expect(typeof authClient.twoFactor.disable).toBe("function");
    expect(typeof authClient.twoFactor.verifyTotp).toBe("function");
    expect(typeof authClient.twoFactor.verifyBackupCode).toBe("function");
    expect(typeof authClient.twoFactor.generateBackupCodes).toBe("function");
  });

  it("exposes the passkey actions, including the atom-derived list hook", () => {
    expect(typeof authClient.passkey.addPasskey).toBe("function");
    expect(typeof authClient.passkey.deletePasskey).toBe("function");
    expect(typeof authClient.signIn.passkey).toBe("function");
    // Not a path-derived action — it comes from the plugin's `getAtoms`.
    expect(typeof authClient.useListPasskeys).toBe("function");
  });

  it("exposes the account actions the profile tab drives", () => {
    expect(typeof authClient.updateUser).toBe("function");
    expect(typeof authClient.changeEmail).toBe("function");
    expect(typeof authClient.changePassword).toBe("function");
    expect(typeof authClient.listSessions).toBe("function");
    expect(typeof authClient.revokeSession).toBe("function");
    expect(typeof authClient.revokeOtherSessions).toBe("function");
  });

  it("exposes the team actions, which only exist because teams are enabled", () => {
    expect(typeof authClient.organization.createTeam).toBe("function");
    expect(typeof authClient.organization.updateTeam).toBe("function");
    expect(typeof authClient.organization.removeTeam).toBe("function");
    expect(typeof authClient.organization.listTeams).toBe("function");
    expect(typeof authClient.organization.listTeamMembers).toBe("function");
    expect(typeof authClient.organization.addTeamMember).toBe("function");
    expect(typeof authClient.organization.removeTeamMember).toBe("function");
  });
});
