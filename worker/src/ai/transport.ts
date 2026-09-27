// Which AI provider the Worker talks to, and with which key. Keys are Wrangler secrets, read only
// here in the Worker; they never reach a response or the browser.
import type { AiProvider } from '../../../shared/aiModels';

/** Tests swap the network for canned replies (and supply keys); production never sets these. */
export const aiTransport: { fetch?: typeof fetch; apiKey?: string; openRouterKey?: string } = {};

export interface AiSetup {
  provider: AiProvider;
  key: string;
}

interface AiEnv {
  ANTHROPIC_API_KEY?: string;
  OPENROUTER_API_KEY?: string;
}

/** OpenRouter when its key is set (it's the one the owner chose), else Anthropic, else not set up. */
export function aiSetup(env: AiEnv): AiSetup | null {
  const openRouter = env.OPENROUTER_API_KEY ?? aiTransport.openRouterKey;
  if (openRouter) return { provider: 'openrouter', key: openRouter };
  const anthropic = env.ANTHROPIC_API_KEY ?? aiTransport.apiKey;
  if (anthropic) return { provider: 'anthropic', key: anthropic };
  return null;
}
