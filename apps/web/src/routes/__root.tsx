import { Toaster } from "@nilovon-wiki/ui/components/sonner";
import type { QueryClient } from "@tanstack/react-query";
import { ReactQueryDevtools } from "@tanstack/react-query-devtools";
import { HeadContent, Outlet, Scripts, createRootRouteWithContext } from "@tanstack/react-router";
import { TanStackRouterDevtools } from "@tanstack/react-router-devtools";
import { createMiddleware } from "@tanstack/react-start";
import { evlogErrorHandler } from "evlog/nitro/v3";

import type { orpc } from "@/utils/orpc";

// Fonts are bundled and served from our own origin — loading them from Google
// Fonts would leak every visitor's IP to a third party (a GDPR problem for
// self-hosted enterprise installs, and a hard failure in air-gapped networks).
import "@fontsource-variable/public-sans";
import "@fontsource-variable/public-sans/wght-italic.css";
import "@fontsource-variable/source-serif-4";
import "@fontsource/jetbrains-mono/400.css";
import "@fontsource/jetbrains-mono/500.css";

import appCss from "../index.css?url";
import { ImpersonationBanner } from "@/components/admin/impersonation-banner";
import { ThemeProvider } from "@/components/theme-provider";
export interface RouterAppContext {
  orpc: typeof orpc;
  queryClient: QueryClient;
}

export const Route = createRootRouteWithContext<RouterAppContext>()({
  server: {
    middleware: [createMiddleware().server(evlogErrorHandler)],
  },
  head: () => ({
    meta: [
      {
        charSet: "utf-8",
      },
      {
        name: "viewport",
        content: "width=device-width, initial-scale=1",
      },
      {
        title: "Wiki - Die private Wiki-Lösung für Teams",
      },
    ],
    links: [
      {
        rel: "stylesheet",
        href: appCss,
      },
    ],
  }),

  component: RootDocument,
});

function RootDocument() {
  return (
    <html lang="de" suppressHydrationWarning>
      <head>
        <HeadContent />
      </head>
      <body>
        <div className="grid h-svh grid-rows-[auto_1fr]">
          <ThemeProvider defaultTheme="system" storageKey="theme">
            {/* Above every route on purpose: an admin must never lose track of
                whose account they are writing in, on any screen. Renders
                nothing unless the session is actually impersonated. */}
            <ImpersonationBanner />
            <Outlet />
          </ThemeProvider>
        </div>
        <Toaster richColors />
        {import.meta.env.DEV ? (
          <>
            <TanStackRouterDevtools position="bottom-left" />
            <ReactQueryDevtools position="bottom" buttonPosition="bottom-right" />
          </>
        ) : null}
        <Scripts />
      </body>
    </html>
  );
}
