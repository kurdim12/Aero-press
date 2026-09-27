// Reading JSON out of a model reply and validating it with zod. Pure, so it's unit tested in Node.
import type { z } from 'zod';

export type ParseResult<T> = { ok: true; data: T } | { ok: false; error: string };

/** The JSON object in a reply, tolerating code fences or a stray sentence around it. */
export function extractJson(text: string): unknown {
  const start = text.indexOf('{');
  const end = text.lastIndexOf('}');
  if (start < 0 || end <= start) throw new Error('no JSON object in the reply');
  return JSON.parse(text.slice(start, end + 1));
}

/** Parse and validate; unknown keys are dropped by the schemas, anything else invalid is reported. */
export function parseAiJson<S extends z.ZodType>(schema: S, text: string): ParseResult<z.output<S>> {
  let raw: unknown;
  try {
    raw = extractJson(text);
  } catch (err) {
    return { ok: false, error: `not valid JSON (${err instanceof Error ? err.message : 'unreadable'})` };
  }
  const result = schema.safeParse(raw);
  if (result.success) return { ok: true, data: result.data };
  const issue = result.error.issues[0];
  const where = issue?.path.map(String).join('.') || 'the reply';
  return { ok: false, error: `${where}: ${issue?.message ?? 'does not match the format'}` };
}

export interface Usage {
  input_tokens: number;
  output_tokens: number;
  cache_creation_input_tokens?: number | null;
  cache_read_input_tokens?: number | null;
}

/** Token counts from a Messages event stream: message_start has the input, the last message_delta the output. */
export function usageFromEvents(text: string): Usage {
  const usage: Usage = { input_tokens: 0, output_tokens: 0 };
  const start = /event: message_start\r?\ndata: (.+)/.exec(text);
  if (start?.[1]) {
    const u = (JSON.parse(start[1]) as { message?: { usage?: Partial<Usage> } }).message?.usage;
    usage.input_tokens = u?.input_tokens ?? 0;
    usage.cache_creation_input_tokens = u?.cache_creation_input_tokens ?? 0;
    usage.cache_read_input_tokens = u?.cache_read_input_tokens ?? 0;
    usage.output_tokens = u?.output_tokens ?? 0;
  }
  const deltas = [...text.matchAll(/event: message_delta\r?\ndata: (.+)/g)];
  const last = deltas[deltas.length - 1]?.[1];
  if (last) {
    const u = (JSON.parse(last) as { usage?: { output_tokens?: number } }).usage;
    if (typeof u?.output_tokens === 'number') usage.output_tokens = u.output_tokens;
  }
  return usage;
}
