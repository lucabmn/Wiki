import type { AppRouter } from "@nilovon-wiki/api/routers/index";
import { env } from "@nilovon-wiki/env/web";
import { createORPCClient } from "@orpc/client";
import { RPCLink } from "@orpc/client/fetch";
import type { RouterClient } from "@orpc/server";
import { createTanstackQueryUtils } from "@orpc/tanstack-query";
import { QueryCache, QueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { BatchLinkPlugin } from "@orpc/client/plugins";

/**
 * Map transport/oRPC errors to friendly German copy instead of dumping raw
 * backend messages (often English or technical) into a toast.
 */
export function friendlyErrorMessage(error: Error): string {
  const code = (error as { code?: string }).code;
  switch (code) {
    case "UNAUTHORIZED":
      return "Deine Sitzung ist abgelaufen. Bitte melde dich erneut an.";
    case "FORBIDDEN":
      return "Dafür fehlt dir die Berechtigung.";
    case "NOT_FOUND":
      return "Der Inhalt wurde nicht gefunden — möglicherweise wurde er gelöscht.";
    case "TOO_MANY_REQUESTS":
      return "Zu viele Anfragen. Bitte warte einen Moment.";
    case "CONFLICT":
      return "Das kollidiert mit einem vorhandenen Eintrag.";
    case "BAD_REQUEST":
      return "Die Eingabe ist ungültig. Bitte prüfe deine Angaben.";
    // The gate normally renders the setup screen before any of this is reached;
    // a toast only shows up in the race where the policy is switched on while a
    // request is already in flight.
    case "TWO_FACTOR_REQUIRED":
      return "Diese Organisation verlangt einen zweiten Faktor. Bitte richte ihn ein.";
  }
  if (error.name === "TypeError" || /fetch|network/i.test(error.message)) {
    return "Der Server ist gerade nicht erreichbar. Prüfe deine Verbindung.";
  }
  return "Etwas ist schiefgelaufen. Bitte versuche es erneut.";
}

export function createQueryClient() {
  return new QueryClient({
    queryCache: new QueryCache({
      onError: (error, query) => {
        toast.error(friendlyErrorMessage(error), {
          // One toast per failure cause at a time — a page with five queries
          // against an unreachable server shouldn't stack five identical toasts.
          id: `query-error-${(error as { code?: string }).code ?? error.name}`,
          action: {
            label: "Erneut versuchen",
            onClick: () => {
              query.invalidate();
            },
          },
        });
      },
    }),
    // Default to 1 minute stale time for queries, so that we don't spam the server
    defaultOptions: { queries: { staleTime: 60 * 1000 } },
  });
}

function getServerUrl(url: string) {
  const normalized = url.endsWith("/") ? url.slice(0, -1) : url;

  if (!normalized.startsWith("/")) {
    return normalized;
  }

  if (typeof window !== "undefined") {
    return `${window.location.origin}${normalized}`;
  }

  const processEnv = (
    globalThis as {
      process?: { env?: Record<string, string | undefined> };
    }
  ).process?.env;
  const vercelUrl =
    processEnv?.VERCEL_ENV === "production"
      ? (processEnv?.VERCEL_PROJECT_PRODUCTION_URL ?? processEnv?.VERCEL_URL)
      : (processEnv?.VERCEL_URL ?? processEnv?.VERCEL_PROJECT_PRODUCTION_URL);
  if (vercelUrl) {
    const origin = vercelUrl.startsWith("http") ? vercelUrl : `https://${vercelUrl}`;
    return `${origin}${normalized}`;
  }

  return `http://localhost:3000${normalized}`;
}
const link = new RPCLink({
  url: `${getServerUrl(env.VITE_SERVER_URL)}/rpc`,
  fetch(url, options) {
    return fetch(url, {
      ...options,
      credentials: "include",
    });
  },
  // Bundle concurrent RPC calls into one HTTP request (POST /rpc/__batch__),
  // cutting round-trips when the UI fires several queries at once. Server side
  // decodes them via BatchHandlerPlugin. One catch-all group batches everything.
  plugins: [
    new BatchLinkPlugin({
      groups: [{ condition: () => true, context: {} }],
    }),
  ],
});

const getORPCClient = () => {
  return createORPCClient(link) as RouterClient<AppRouter>;
};

export const client: RouterClient<AppRouter> = getORPCClient();

export const orpc = createTanstackQueryUtils(client);
