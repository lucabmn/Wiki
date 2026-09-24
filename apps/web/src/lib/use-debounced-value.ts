import { useEffect, useState } from "react";

/**
 * Trailing-edge debounce of a (search) string, trimmed — keeps an input
 * responsive without firing a query per keystroke.
 */
export function useDebouncedValue(value: string, delayMs: number): string {
  const [debounced, setDebounced] = useState(() => value.trim());
  useEffect(() => {
    const timer = setTimeout(() => setDebounced(value.trim()), delayMs);
    return () => clearTimeout(timer);
  }, [value, delayMs]);
  return debounced;
}
