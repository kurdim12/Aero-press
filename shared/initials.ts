/**
 * Two-letter initials for avatars and recipe codes ("Abdelrahman Kurdi" -> "AK").
 * One-word names use their first two letters ("Omar" -> "OM").
 */
export function initialsOf(name: string): string {
  const words = name.trim().split(/\s+/).filter(Boolean);
  const first = words[0];
  if (!first) return '?';
  const firstChars = [...first];
  if (words.length === 1) return firstChars.slice(0, 2).join('').toUpperCase();
  const lastChars = [...(words[words.length - 1] ?? '')];
  return `${firstChars[0] ?? ''}${lastChars[0] ?? ''}`.toUpperCase();
}
