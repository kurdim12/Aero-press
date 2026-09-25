// PIN hashing and session tokens, all on WebCrypto.
import { PIN_HASH_ITERATIONS } from '../config';

const PIN_HASH_BITS = 256;
/** Stored hashes look like `pbkdf2-sha256$20000$<base64>` so each records its own round count. */
const HASH_PREFIX = 'pbkdf2-sha256';
/** Hashes written before the round count was recorded (bare base64) used 100k rounds. */
const LEGACY_ITERATIONS = 100_000;
/** The Workers runtime refuses more than 100k rounds. */
const MAX_ITERATIONS = 100_000;
const MIN_ITERATIONS = 1_000;
const SALT_BYTES = 16;
const TOKEN_BYTES = 32;

const encoder = new TextEncoder();

export function bytesToBase64(bytes: Uint8Array): string {
  let binary = '';
  for (const b of bytes) binary += String.fromCharCode(b);
  return btoa(binary);
}

export function base64ToBytes(value: string): Uint8Array {
  const binary = atob(value);
  const out = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) out[i] = binary.charCodeAt(i);
  return out;
}

function toBase64Url(bytes: Uint8Array): string {
  return bytesToBase64(bytes).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

/** Constant-time comparison so hash checks don't leak how many bytes matched. */
export function timingSafeEqual(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= (a[i] ?? 0) ^ (b[i] ?? 0);
  return diff === 0;
}

async function derivePin(pin: string, salt: Uint8Array, iterations: number): Promise<Uint8Array> {
  const key = await crypto.subtle.importKey('raw', encoder.encode(pin), 'PBKDF2', false, ['deriveBits']);
  const bits = await crypto.subtle.deriveBits({ name: 'PBKDF2', hash: 'SHA-256', salt, iterations }, key, PIN_HASH_BITS);
  return new Uint8Array(bits);
}

export interface PinHash {
  hash: string;
  salt: string;
}

/** Split a stored hash into its round count and digest, or null if it isn't one of ours. */
function parseStoredHash(stored: string): { iterations: number; digest: string } | null {
  const parts = stored.split('$');
  if (parts.length === 1) return { iterations: LEGACY_ITERATIONS, digest: stored };
  const [prefix, rounds, digest] = parts;
  if (parts.length !== 3 || prefix !== HASH_PREFIX || !digest) return null;
  const iterations = Number(rounds);
  if (!Number.isInteger(iterations) || iterations < MIN_ITERATIONS || iterations > MAX_ITERATIONS) return null;
  return { iterations, digest };
}

/** Hash a PIN with a fresh random salt and the configured round count. */
export async function hashPin(pin: string): Promise<PinHash> {
  const salt = crypto.getRandomValues(new Uint8Array(SALT_BYTES));
  const digest = await derivePin(pin, salt, PIN_HASH_ITERATIONS);
  return { hash: `${HASH_PREFIX}$${PIN_HASH_ITERATIONS}$${bytesToBase64(digest)}`, salt: bytesToBase64(salt) };
}

/** Check a PIN against a stored hash, using the round count recorded with that hash. */
export async function verifyPin(pin: string, stored: PinHash): Promise<boolean> {
  const parsed = parseStoredHash(stored.hash);
  if (!parsed) return false;
  let expected: Uint8Array;
  let salt: Uint8Array;
  try {
    expected = base64ToBytes(parsed.digest);
    salt = base64ToBytes(stored.salt);
  } catch {
    return false;
  }
  const actual = await derivePin(pin, salt, parsed.iterations);
  return timingSafeEqual(actual, expected);
}

/** Random 32-byte session token for the cookie. Only its SHA-256 is stored. */
export function newSessionToken(): string {
  return toBase64Url(crypto.getRandomValues(new Uint8Array(TOKEN_BYTES)));
}

export async function sha256Base64(value: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', encoder.encode(value));
  return bytesToBase64(new Uint8Array(digest));
}
