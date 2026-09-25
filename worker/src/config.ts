// Server tunables in one place. Phase 5 adds the AI model IDs and prices here.

/**
 * PBKDF2-SHA256 rounds for new PIN hashes.
 *
 * The team runs on the Workers Free plan, which allows 10 ms of CPU per request, and the
 * heaviest requests (setup, owner or team PIN change) hash twice. 20k rounds costs about
 * 3 ms per hash, so those stay near 7 ms. On Workers Paid this can go up to 100_000 (the
 * runtime's maximum). Changing it is safe: every stored hash records its own round count,
 * so existing PINs keep working and only new or reset PINs use the new number.
 */
export const PIN_HASH_ITERATIONS = 20_000;
