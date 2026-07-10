/** Split a member's comma-separated role string into individual role names. */
export function splitRoles(role: string | null | undefined): string[] {
  return (role ?? "")
    .split(",")
    .map((part) => part.trim())
    .filter(Boolean);
}
