/** Text cut to `max` characters at the end of a sentence, or at a word with "…" if none fits. */
export function clipToSentence(text: string, max: number): string {
  const t = text.trim();
  if (t.length <= max) return t;
  const head = t.slice(0, max);
  const end = Math.max(head.lastIndexOf('. '), head.lastIndexOf('! '), head.lastIndexOf('? '));
  if (end >= max / 3) return head.slice(0, end + 1);
  const space = head.lastIndexOf(' ', max - 1);
  return `${head.slice(0, space > 0 ? space : max - 1).trimEnd()}…`;
}
