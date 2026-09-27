// OpenRouter's chat-completions API (OpenAI-compatible). Every call streams: bytes keep flowing
// (OpenRouter sends keep-alive comments while a model thinks), so a long answer is never cut off
// by a timeout waiting for the whole reply.
import { type ChatUsage, deltaText, isStreamError, parseDataLine } from '../../../shared/aiStream';
import { type AiKind, MAX_TOKENS } from './config';
import { aiTransport } from './transport';

export const OPENROUTER_URL = 'https://openrouter.ai/api/v1/chat/completions';

/** Waiting longer than this for the first byte means the request is stuck. */
const FIRST_BYTE_MS = 90_000;

/** OpenRouter answered with an HTTP error: the request was turned away, so nothing was billed. */
export class ProviderHttpError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
    this.name = 'ProviderHttpError';
  }
}

/** The answer broke off with an error after it started; what came so far can't be used. */
export class ProviderStreamError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ProviderStreamError';
  }
}

/** Thinking effort per job (quick parsing thinks little). The thinking itself is never sent back. */
const EFFORT: Record<AiKind, 'low' | 'medium'> = {
  plan: 'medium',
  adapt: 'medium',
  readiness: 'medium',
  ask: 'medium',
  today: 'low',
  duelRead: 'low',
  quickLog: 'low',
  brewRead: 'low',
};

export function chatBody(model: string, kind: AiKind, system: string, user: string) {
  return {
    model,
    max_tokens: MAX_TOKENS[kind],
    stream: true,
    messages: [
      { role: 'system', content: system },
      { role: 'user', content: user },
    ],
    reasoning: { effort: EFFORT[kind], exclude: true },
  };
}

/** Send one request and return its event stream, or throw ProviderHttpError. */
export async function openRouterStream(key: string, body: ReturnType<typeof chatBody>): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FIRST_BYTE_MS);
  let res: Response;
  try {
    res = await (aiTransport.fetch ?? fetch)(OPENROUTER_URL, {
      method: 'POST',
      headers: { authorization: `Bearer ${key}`, 'content-type': 'application/json', 'x-title': 'AeroPress Lab' },
      body: JSON.stringify(body),
      signal: controller.signal,
    });
  } finally {
    clearTimeout(timer);
  }
  if (!res.ok) {
    let message = `HTTP ${res.status}`;
    try {
      const data = (await res.json()) as { error?: { message?: string } };
      message = data.error?.message ?? message;
    } catch {
      // not JSON; the status says enough
    }
    throw new ProviderHttpError(res.status, message);
  }
  if (!res.body) throw new ProviderStreamError('empty stream');
  return res;
}

export interface ChatResult {
  text: string;
  usage: ChatUsage | null;
  /** stop, length, content_filter… (null if the stream never said). */
  finish: string | null;
}

/** Read a whole streamed answer: its text, what it cost, and why it stopped. */
export async function readChatStream(body: ReadableStream<Uint8Array>): Promise<ChatResult> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  let text = '';
  let usage: ChatUsage | null = null;
  let finish: string | null = null;
  const take = (line: string) => {
    const event = parseDataLine(line.trim());
    if (!event) return;
    if (isStreamError(event)) {
      throw new ProviderStreamError(typeof event.error === 'string' ? event.error : (event.error?.message ?? 'the answer broke off'));
    }
    text += deltaText(event);
    finish = event.choices?.[0]?.finish_reason ?? finish;
    if (event.usage) {
      usage = {
        prompt_tokens: event.usage.prompt_tokens ?? 0,
        completion_tokens: event.usage.completion_tokens ?? 0,
        cost: typeof event.usage.cost === 'number' ? event.usage.cost : null,
      };
    }
  };
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    let nl = buffer.indexOf('\n');
    while (nl >= 0) {
      take(buffer.slice(0, nl));
      buffer = buffer.slice(nl + 1);
      nl = buffer.indexOf('\n');
    }
  }
  buffer += decoder.decode();
  if (buffer) take(buffer);
  return { text: text.trim(), usage, finish };
}
