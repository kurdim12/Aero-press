// nanoid-style IDs: 21 URL-safe characters from crypto.getRandomValues.
const ALPHABET = 'useandom-26T198340PX75pxJACKVERYMINDBUSHWOLF_GQZbfghjklqvwyzrict';

export function newId(size = 21): string {
  const bytes = crypto.getRandomValues(new Uint8Array(size));
  let id = '';
  // 64-character alphabet, so masking with 63 keeps the distribution uniform.
  for (const b of bytes) id += ALPHABET[b & 63];
  return id;
}
