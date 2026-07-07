import { createRouter as createTanStackRouter } from "@tanstack/react-router";
import { setupRouterSsrQueryIntegration } from "@tanstack/react-router-ssr-query";

import ErrorScreen from "./components/default-screens/error-screen";
import LoadingScreen from "./components/default-screens/loading-screen";
import NotFoundScreen from "./components/default-screens/not-found-screen";
import { routeTree } from "./routeTree.gen";
import { createQueryClient, orpc } from "./utils/orpc";

export const getRouter = () => {
  const queryClient = createQueryClient();

  const router = createTanStackRouter({
    routeTree,
    scrollRestoration: true,
    defaultPreloadStaleTime: 0,
    context: { orpc, queryClient },
    defaultPendingComponent: () => <LoadingScreen />,
    defaultErrorComponent: ({ error, reset }) => <ErrorScreen error={error} reset={reset} />,
    defaultNotFoundComponent: () => <NotFoundScreen />,
  });

  setupRouterSsrQueryIntegration({
    router,
    queryClient,
  });

  return router;
};

declare module "@tanstack/react-router" {
  interface Register {
    router: ReturnType<typeof getRouter>;
  }
}
