import { useEffect, useState } from "react";

/**
 * Mermaid bakes its colors into the SVG, so a diagram has to be re-rendered
 * when the app switches theme. The theme lives as a class on `<html>`
 * (`components/theme-provider.tsx`), which both the React views and the
 * plain-DOM read view can observe without a context — the read view runs inside
 * `dangerouslySetInnerHTML` markup and has no React tree of its own.
 */
export function isDarkTheme(): boolean {
  return typeof document !== "undefined" && document.documentElement.classList.contains("dark");
}

export function useDarkTheme(): boolean {
  const [dark, setDark] = useState(isDarkTheme);

  useEffect(() => {
    const root = document.documentElement;
    const sync = () => setDark(root.classList.contains("dark"));
    const observer = new MutationObserver(sync);
    observer.observe(root, { attributes: true, attributeFilter: ["class"] });
    // The class is applied in an effect after hydration, so read it once more.
    sync();
    return () => observer.disconnect();
  }, []);

  return dark;
}
