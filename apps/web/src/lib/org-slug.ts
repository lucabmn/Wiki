import { z } from "zod";

/**
 * Better Auth looks organizations up by slug, so it must stay URL-safe and
 * stable. One schema for onboarding and the settings form — otherwise a slug
 * accepted at creation can be refused on the next unrelated save.
 */
export const orgSlugSchema = z
  .string()
  .min(2, "Mindestens 2 Zeichen")
  .max(60, "Höchstens 60 Zeichen")
  .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, "Nur Kleinbuchstaben, Ziffern und Bindestriche");

/** Best-effort slug from a display name: "Nordwind GmbH" → "nordwind-gmbh". */
export function slugify(input: string): string {
  return input
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60);
}

/**
 * Keystroke-level cleanup for a slug being typed by hand. Unlike `slugify` it
 * keeps a trailing hyphen — otherwise "nord-wind" cannot be typed, because the
 * hyphen vanishes the moment it is entered. The schema rejects a slug that is
 * left ending in one.
 */
export function sanitizeSlugInput(input: string): string {
  return input
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9-]+/g, "-")
    .replace(/-{2,}/g, "-")
    .replace(/^-+/, "")
    .slice(0, 60);
}
