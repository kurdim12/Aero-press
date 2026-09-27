// AI models and prices in one place, so they change without touching any logic.

/** Which model does what. Coach work uses Sonnet; quick parsing and one-liners use Haiku. */
export const MODELS = {
  plan: 'claude-sonnet-5',
  adapt: 'claude-sonnet-5',
  today: 'claude-sonnet-5',
  readiness: 'claude-sonnet-5',
  ask: 'claude-sonnet-5',
  duelRead: 'claude-sonnet-5',
  quickLog: 'claude-haiku-4-5-20251001',
  brewRead: 'claude-haiku-4-5-20251001',
} as const;

export type AiKind = keyof typeof MODELS;

/** US dollars per million tokens (Anthropic API list prices). */
export const PRICES: Record<string, { input: number; output: number }> = {
  'claude-sonnet-5': { input: 2, output: 10 },
  'claude-haiku-4-5-20251001': { input: 1, output: 5 },
};

/** Output ceilings per call: generous enough never to cut a JSON answer short. */
export const MAX_TOKENS: Record<AiKind, number> = {
  plan: 8000,
  adapt: 8000,
  today: 3000,
  readiness: 6000,
  ask: 8000,
  duelRead: 3000,
  quickLog: 1500,
  brewRead: 400,
};

/**
 * Sonnet 5 thinks adaptively by default; effort keeps each call's cost in proportion to the job.
 * Haiku 4.5 takes no effort setting.
 */
export const EFFORT: Partial<Record<AiKind, 'low' | 'medium' | 'high'>> = {
  plan: 'medium',
  adapt: 'medium',
  readiness: 'medium',
  ask: 'medium',
  today: 'low',
  duelRead: 'low',
};

/** The team's months run on Amman time (UTC+3 all year since 2022). */
export const TEAM_UTC_OFFSET_MS = 3 * 60 * 60 * 1000;

export function costUsd(model: string, inputTokens: number, outputTokens: number): number {
  const price = PRICES[model];
  if (!price) return 0;
  return (inputTokens * price.input + outputTokens * price.output) / 1_000_000;
}

/** Epoch ms of the start of the current month in Amman. */
export function monthStart(now = Date.now()): number {
  const local = new Date(now + TEAM_UTC_OFFSET_MS);
  return Date.UTC(local.getUTCFullYear(), local.getUTCMonth(), 1) - TEAM_UTC_OFFSET_MS;
}

/** YYYY-MM-DD in Amman, for "today" caches. */
export function localDay(now = Date.now()): string {
  return new Date(now + TEAM_UTC_OFFSET_MS).toISOString().slice(0, 10);
}
