// Reading streamed answers from either provider: Anthropic's Messages events and OpenRouter's
// OpenAI-style chat chunks. Pure, so the phone and the Worker share it and Node tests cover it.

interface StreamEvent {
  type?: string;
  delta?: { type?: string; text?: string };
  error?: { message?: string } | string;
  choices?: { delta?: { content?: string | null }; finish_reason?: string | null }[];
  usage?: { prompt_tokens?: number; completion_tokens?: number; cost?: number };
}

/** The JSON payload of one SSE line; null for comments (": OPENROUTER PROCESSING"), [DONE] and junk. */
export function parseDataLine(line: string): StreamEvent | null {
  if (!line.startsWith('data:')) return null;
  const data = line.slice(5).trim();
  if (!data || data === '[DONE]') return null;
  try {
    const parsed: unknown = JSON.parse(data);
    return parsed && typeof parsed === 'object' ? (parsed as StreamEvent) : null;
  } catch {
    return null;
  }
}

/** The answer text one event adds (Anthropic text deltas, or chat-completion content deltas). */
export function deltaText(event: StreamEvent): string {
  if (event.type === 'content_block_delta' && event.delta?.type === 'text_delta') return event.delta.text ?? '';
  const content = event.choices?.[0]?.delta?.content;
  return typeof content === 'string' ? content : '';
}

/** A failure reported after the stream started (the answer so far can't be trusted). */
export function isStreamError(event: StreamEvent): boolean {
  return event.type === 'error' || event.error !== undefined || event.choices?.[0]?.finish_reason === 'error';
}

export interface ChatUsage {
  prompt_tokens: number;
  completion_tokens: number;
  /** What OpenRouter charged, in US dollars (null if it didn't say). */
  cost: number | null;
}

/** Tokens and cost from a whole chat-completion stream: OpenRouter sends them in the last chunk. */
export function chatStreamUsage(text: string): ChatUsage | null {
  const at = text.lastIndexOf('"usage"');
  if (at < 0) return null;
  const start = text.lastIndexOf('\n', at) + 1;
  const end = text.indexOf('\n', at);
  const usage = parseDataLine(text.slice(start, end < 0 ? undefined : end).trim())?.usage;
  if (!usage) return null;
  return {
    prompt_tokens: usage.prompt_tokens ?? 0,
    completion_tokens: usage.completion_tokens ?? 0,
    cost: typeof usage.cost === 'number' ? usage.cost : null,
  };
}
