import type { BaseLayoutProps } from "fumadocs-ui/layouts/shared";
import { appName, docsRoute, githubUrl } from "./shared";

/** The Nilovon glyph — a stylized stacked-pages "N" that doubles as the favicon. */
export function Logo({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 32 32"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      aria-hidden
      className={className}
    >
      <rect width="32" height="32" rx="8" className="fill-fd-primary" />
      <path
        d="M9 23V9h2.6l9.8 10.2V9H24v14h-2.6L11.6 12.8V23H9Z"
        className="fill-fd-primary-foreground"
      />
    </svg>
  );
}

export function baseOptions(): BaseLayoutProps {
  return {
    nav: {
      title: (
        <span className="inline-flex items-center gap-2 font-semibold">
          <Logo className="size-6" />
          {appName}
        </span>
      ),
      transparentMode: "top",
    },
    githubUrl,
    links: [
      {
        text: "Documentation",
        url: docsRoute,
        active: "nested-url",
      },
      {
        text: "Self-hosting",
        url: `${docsRoute}/self-hosting/docker`,
      },
      {
        text: "API v1",
        url: `${docsRoute}/v1/overview`,
      },
    ],
  };
}
