import { Outlet, createFileRoute } from "@tanstack/react-router";

import { getUser } from "@/functions/get-user";

export const Route = createFileRoute("/_auth")({
  ssr: false,
  component: AuthLayout,
  beforeLoad: async () => {
    const auth = await getUser();
    return { auth };
  },
});

function AuthLayout() {
  return <Outlet />;
}
