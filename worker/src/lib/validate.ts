import type { Context } from 'hono';
import type { z } from 'zod';
import { ApiError } from './errors';

/**
 * Parse and validate a JSON request body with zod. Requiring the JSON content
 * type also means a cross-site HTML form can never reach a state-changing route.
 */
export async function readJson<S extends z.ZodType>(c: Context, schema: S): Promise<z.output<S>> {
  const type = c.req.header('content-type') ?? '';
  if (!type.toLowerCase().startsWith('application/json')) {
    throw new ApiError(415, 'json_required', 'The app sent data in the wrong format. Reload the page and try again.');
  }
  let raw: unknown;
  try {
    raw = await c.req.json();
  } catch {
    throw new ApiError(400, 'bad_json', 'The app sent data it could not read. Reload the page and try again.');
  }
  const result = schema.safeParse(raw);
  if (!result.success) {
    const issue = result.error.issues[0];
    const field = issue?.path.map(String).join('.') ?? '';
    throw new ApiError(400, 'invalid_input', issue?.message ?? 'Check the form and try again.', { field });
  }
  return result.data;
}
