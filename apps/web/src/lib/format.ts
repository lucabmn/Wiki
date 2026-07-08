/** Up to two uppercase initials from a display name, e.g. "Luca Braun" → "LB". */
export function initials(name: string): string {
  return name
    .split(" ")
    .map((part) => part.charAt(0))
    .join("")
    .slice(0, 2)
    .toUpperCase();
}
