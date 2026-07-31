import { createFileRoute, redirect } from "@tanstack/react-router";

export const Route = createFileRoute("/_auth/settings/")({
  beforeLoad: () => {
    // The profile tab, not the members tab: /settings is reachable by every
    // signed-in user now, and only the personal tabs are ungated.
    throw redirect({ to: "/settings/profile" });
  },
});
