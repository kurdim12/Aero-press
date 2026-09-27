// AI models and prices in one place, so they change without touching any logic. The OpenRouter
// models the owner can pick from (and their prices) are in shared/aiModels.ts.
import { ANTHROPIC_MODELS, type ModelRole, OPENROUTER_MODELS } from '../../../shared/aiModels';

/**
 * Which model does what on an Anthropic key: coach work uses Sonnet; quick parsing and one-liners
 * use Haiku. On OpenRouter the owner picks a model per role in Settings.
 */
export const MODELS = {
  plan: 'claude-sonnet-5',
  adapt: 'claude-sonnet-5',
  today: 'claude-sonnet-5',
  readiness: 'claude-sonnet-5',
  ask: 'claude-sonnet-5',
  duelRead: 'claude-sonnet-5',
  beanTips: 'claude-sonnet-5',
  recipeTips: 'claude-sonnet-5',
  compare: 'claude-sonnet-5',
  quickLog: 'claude-haiku-4-5-20251001',
  brewRead: 'claude-haiku-4-5-20251001',
} as const;

export type AiKind = keyof typeof MODELS;

/** Which role's model each job uses. */
export const KIND_ROLE: Record<AiKind, ModelRole> = {
  plan: 'coach',
  adapt: 'coach',
  today: 'coach',
  readiness: 'coach',
  ask: 'coach',
  duelRead: 'coach',
  beanTips: 'coach',
  recipeTips: 'coach',
  compare: 'coach',
  quickLog: 'quick',
  brewRead: 'quick',
};

/** US dollars per million tokens (list prices), for every model the app can call. */
export const PRICES: Record<string, { input: number; output: number }> = Object.fromEntries(
  [...ANTHROPIC_MODELS, ...OPENROUTER_MODELS].map((m) => [m.id, { input: m.input, output: m.output }]),
);

/**
 * Output ceilings per call, thinking included: generous enough never to cut a JSON answer short.
 * Only what a call actually uses is billed.
 */
export const MAX_TOKENS: Record<AiKind, number> = {
  plan: 8000,
  adapt: 8000,
  today: 3000,
  readiness: 6000,
  ask: 8000,
  duelRead: 3000,
  beanTips: 3000,
  recipeTips: 3000,
  compare: 2500,
  quickLog: 3000,
  brewRead: 1500,
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
  beanTips: 'low',
  recipeTips: 'low',
  compare: 'low',
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
