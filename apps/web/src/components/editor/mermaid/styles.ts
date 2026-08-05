/**
 * Class names shared by the two renderers of the same node: the React node view
 * (editor) and the plain-DOM enhancer (read view / revision preview). One source
 * so a diagram looks identical whether you are writing it or reading it.
 */

export const FIGURE_CLASS = "not-prose my-4 flex flex-col items-center gap-2";

export const SURFACE_CLASS =
  "flex w-full justify-center overflow-x-auto rounded-xl border border-border bg-card p-4";

export const CAPTION_CLASS = "text-center text-sm text-muted-foreground";

export const ERROR_CLASS =
  "w-full rounded-xl border border-destructive/40 bg-destructive/5 p-3 text-sm text-destructive";

export const ERROR_MESSAGE_CLASS = "font-medium";

export const ERROR_SOURCE_CLASS =
  "mt-2 max-h-48 overflow-auto rounded-lg bg-muted/60 p-2 text-xs whitespace-pre-wrap text-muted-foreground";

export const PENDING_CLASS =
  "flex w-full animate-pulse items-center justify-center rounded-xl border border-border border-dashed bg-muted/30 p-6 text-sm text-muted-foreground";
