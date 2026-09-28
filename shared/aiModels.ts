// The AI models the app can use, with list prices, shared by the Worker (pricing, validation) and
// the web app (the model picker in Settings). Prices are US dollars per million tokens.

export type AiProvider = 'anthropic' | 'openrouter';

/** The two jobs a model does: coaching (plans, reads, reports) and quick parsing (quick log, brew reads). */
export type ModelRole = 'coach' | 'quick';

export interface AiModel {
  id: string;
  label: string;
  input: number;
  output: number;
}

/**
 * Models offered through OpenRouter (September 2026 list prices on openrouter.ai). The owner picks
 * one per role in Settings; OpenRouter's own reported cost is what the budget counts, these prices
 * only size the reservation made before each call.
 */
export const OPENROUTER_MODELS = [
  { id: 'google/gemini-3.8-flash', label: 'Gemini 3.8 Flash', input: 0.75, output: 3.75 },
  { id: 'deepseek/deepseek-v4-pro-0813', label: 'DeepSeek V4 Pro', input: 0.66, output: 1.98 },
  { id: 'deepseek/deepseek-v4.1-flash', label: 'DeepSeek V4.1 Flash', input: 0.035, output: 0.29 },
  { id: 'anthropic/claude-sonnet-5', label: 'Claude Sonnet 5', input: 2, output: 10 },
  // Added 28 Sept 2026 (released 22 Sept); prices from OpenRouter's listings.
  { id: 'openai/gpt-6-sol', label: 'GPT-6 Sol', input: 2, output: 10 },
  { id: 'openai/gpt-6-luna', label: 'GPT-6 Luna', input: 0.1, output: 0.5 },
] as const satisfies readonly AiModel[];

export type OpenRouterModelId = (typeof OPENROUTER_MODELS)[number]['id'];
export const OPENROUTER_MODEL_IDS = OPENROUTER_MODELS.map((m) => m.id) as [OpenRouterModelId, ...OpenRouterModelId[]];

/** Used until the owner picks: cheaper than Claude Sonnet and Haiku, and strong on reasoning. */
export const OPENROUTER_DEFAULTS: Record<ModelRole, OpenRouterModelId> = {
  coach: 'google/gemini-3.8-flash',
  quick: 'google/gemini-3.8-flash',
};

/** Models used directly through an Anthropic key (no choice there: the spec's pair). */
export const ANTHROPIC_MODELS: readonly AiModel[] = [
  { id: 'claude-sonnet-5', label: 'Claude Sonnet 5', input: 2, output: 10 },
  { id: 'claude-haiku-4-5-20251001', label: 'Claude Haiku 4.5', input: 1, output: 5 },
];

/** A readable name for any model id the app uses. */
export function modelLabel(id: string): string {
  return [...OPENROUTER_MODELS, ...ANTHROPIC_MODELS].find((m) => m.id === id)?.label ?? id;
}
