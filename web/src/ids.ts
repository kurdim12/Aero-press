// Same 21-character alphabet as the Worker's IDs, made on the phone for brews that may be
// queued offline (the Worker accepts them and treats a repeat as the same brew).
const ALPHABET = 'useandom-26T198340PX75pxJACKVERYMINDBUSHWOLF_GQZbfghjklqvwyzrict';

export function newClientId(size = 21): string {
  const bytes = crypto.getRandomValues(new Uint8Array(size));
  let id = '';
  for (const b of bytes) id += ALPHABET[b & 63];
  return id;
}
