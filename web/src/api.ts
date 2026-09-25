import type { ApiErrorBody } from '../../shared/types';
import { strings } from './strings';

/** An API failure with a message ready to show the user. */
export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
    readonly body: ApiErrorBody['error'] | null = null,
  ) {
    super(message);
    this.name = 'ApiError';
  }

  /** Which form field the server complained about, if any. */
  get field(): string | undefined {
    const field = (this.body as Record<string, unknown> | null)?.field;
    return typeof field === 'string' && field ? field : undefined;
  }
}

function messageFor(status: number, body: ApiErrorBody['error'] | undefined): string {
  if (!body) return status >= 500 ? strings.errors.byCode.server_error as string : strings.errors.generic;
  const local = strings.errors.byCode[body.code];
  if (typeof local === 'function') return local(body as unknown as Record<string, unknown>);
  if (typeof local === 'string') return local;
  return body.message || strings.errors.generic;
}

let onSignedOut: (() => void) | null = null;

/** The app registers this once so any "signed out" response returns to the sign-in screen. */
export function setSignedOutHandler(handler: () => void): void {
  onSignedOut = handler;
}

export interface ApiOptions {
  /** Give up after this long. Like no connection, it fails with status 0 (code 'timeout'). */
  timeoutMs?: number;
}

export async function api<T>(
  method: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE',
  path: string,
  body?: unknown,
  options: ApiOptions = {},
): Promise<T> {
  const controller = options.timeoutMs ? new AbortController() : null;
  const timer = controller ? window.setTimeout(() => controller.abort(), options.timeoutMs) : undefined;
  let res: Response;
  let text: string;
  try {
    res = await fetch(path, {
      method,
      credentials: 'same-origin',
      headers: body === undefined ? {} : { 'content-type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: controller?.signal,
    });
    text = await res.text();
  } catch {
    if (controller?.signal.aborted) throw new ApiError(0, 'timeout', strings.errors.timeout);
    throw new ApiError(0, 'offline', strings.errors.offline);
  } finally {
    window.clearTimeout(timer);
  }

  let data: unknown = null;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    data = null;
  }

  if (!res.ok) {
    const err = (data as ApiErrorBody | null)?.error;
    const apiError = new ApiError(res.status, err?.code ?? `http_${res.status}`, messageFor(res.status, err), err ?? null);
    if (apiError.code === 'not_signed_in') onSignedOut?.();
    throw apiError;
  }
  return data as T;
}

export function errorMessage(err: unknown): string {
  if (err instanceof ApiError) return err.message;
  return strings.errors.generic;
}
