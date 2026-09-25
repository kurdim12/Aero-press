import { env } from 'cloudflare:workers';
import { beforeEach, describe, expect, it } from 'vitest';
import { PIN_HASH_ITERATIONS } from '../src/config';
import { bytesToBase64, hashPin, verifyPin } from '../src/lib/crypto';
import { OWNER_PIN, freshDb, setupTeam, signIn } from './helpers';

/** A hash in the original phase 1 format: bare base64 digest, 100k rounds. */
async function legacyHash(pin: string) {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(pin), 'PBKDF2', false, ['deriveBits']);
  const bits = await crypto.subtle.deriveBits({ name: 'PBKDF2', hash: 'SHA-256', salt, iterations: 100_000 }, key, 256);
  return { hash: bytesToBase64(new Uint8Array(bits)), salt: bytesToBase64(salt) };
}

describe('PIN hashes', () => {
  it('record their round count and verify', async () => {
    const stored = await hashPin('1357');
    expect(stored.hash.startsWith(`pbkdf2-sha256$${PIN_HASH_ITERATIONS}$`)).toBe(true);
    expect(await verifyPin('1357', stored)).toBe(true);
    expect(await verifyPin('1358', stored)).toBe(false);
  });

  it('stay cheap enough for the Workers Free plan', () => {
    // Free allows 10 ms of CPU per request; setup and PIN changes hash twice.
    // Measured cost is about 0.16 ms per 1k rounds, so 25k is the ceiling.
    expect(PIN_HASH_ITERATIONS).toBeLessThanOrEqual(25_000);
  });

  it('still accept hashes written before the round count was recorded', async () => {
    const stored = await legacyHash('246810');
    expect(await verifyPin('246810', stored)).toBe(true);
    expect(await verifyPin('246811', stored)).toBe(false);
  });

  it('reject malformed hashes instead of throwing', async () => {
    const { hash, salt } = await hashPin('1357');
    const digest = hash.split('$')[2] ?? '';
    const malformed = [
      `md5$${PIN_HASH_ITERATIONS}$${digest}`,
      `pbkdf2-sha256$lots$${digest}`,
      `pbkdf2-sha256$5000000$${digest}`,
      `pbkdf2-sha256$${PIN_HASH_ITERATIONS}$`,
      'not base64 !!',
      'a$b',
    ];
    for (const bad of malformed) expect(await verifyPin('1357', { hash: bad, salt })).toBe(false);
    expect(await verifyPin('1357', { hash, salt: '%%%' })).toBe(false);
  });
});

describe('teams created before the change', () => {
  beforeEach(freshDb);

  it('an owner PIN stored in the old format still signs in', async () => {
    const { me } = await setupTeam();
    const legacy = await legacyHash(OWNER_PIN);
    await env.DB.prepare('UPDATE members SET pin_hash = ?, pin_salt = ? WHERE id = ?')
      .bind(legacy.hash, legacy.salt, me.member.id)
      .run();
    expect((await signIn(me.member.id, OWNER_PIN)).res.status).toBe(200);
    expect((await signIn(me.member.id, '999999')).res.status).toBe(401);
  });
});
