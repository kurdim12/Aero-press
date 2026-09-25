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
  return parseWith(schema, raw);
}

/** Validate query-string parameters with zod. */
export function readQuery<S extends z.ZodType>(c: Context, schema: S): z.output<S> {
  return parseWith(schema, c.req.query());
}

/** A path id: anything malformed is simply "not found". */
export function idParam(c: Context, what: string, name = 'id'): string {
  const value = c.req.param(name) ?? '';
  if (value.length < 1 || value.length > 100) {
    throw new ApiError(404, 'not_found', `That ${what} no longer exists. Go back and refresh the list.`);
  }
  return value;
}

function parseWith<S extends z.ZodType>(schema: S, raw: unknown): z.output<S> {
  const result = schema.safeParse(raw);
  if (!result.success) {
    const issue = result.error.issues[0];
    const field = issue?.path.map(String).join('.') ?? '';
    throw new ApiError(400, 'invalid_input', issue?.message ?? 'Check the form and try again.', { field });
  }
  return result.data;
}
