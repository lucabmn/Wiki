import { Outlet, createFileRoute } from "@tanstack/react-router";

import { getUser } from "@/functions/get-user";

export const Route = createFileRoute("/_auth")({
  ssr: false,
  component: AuthLayout,
  beforeLoad: async () => {
    return { auth: undefined };
  },
});

function AuthLayout() {
  return <Outlet />;
}
