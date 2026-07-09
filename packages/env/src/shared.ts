import { z } from "zod";

/**
 * Placeholder secrets that ship in `.env.example` files or that operators
 * commonly type when they "just want it to boot". They satisfy the length
 * requirement, so without this guard a forgotten placeholder would silently
 * become the production signing key for sessions AND collab tokens.
 */
const PLACEHOLDER_SECRET = /change[-_ ]?me|your[-_ ]?secret|example|placeholder/i;

export const authSecretSchema = z
  .string()
  .min(32, "BETTER_AUTH_SECRET must be at least 32 characters")
  .refine((value) => !PLACEHOLDER_SECRET.test(value), {
    message:
      "BETTER_AUTH_SECRET is still a placeholder value. Generate a real one, e.g.: openssl rand -base64 48",
  })
  .refine((value) => new Set(value).size >= 8, {
    message:
      "BETTER_AUTH_SECRET has too little variety to be a real secret. Generate one, e.g.: openssl rand -base64 48",
  });

export const databaseUrlSchema = z.string().min(1);

export const nodeEnvSchema = z.enum(["development", "production", "test"]).default("development");
