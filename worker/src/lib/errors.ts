import type { ContentfulStatusCode } from 'hono/utils/http-status';

/**
 * An error the user should see. `message` says what happened and what to do;
 * `code` lets the web app swap in its own (translatable) wording.
 */
export class ApiError extends Error {
  constructor(
    readonly status: ContentfulStatusCode,
    readonly code: string,
    message: string,
    readonly extra: Record<string, string | number> = {},
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

export const notSignedIn = () =>
  new ApiError(401, 'not_signed_in', 'You are signed out. Sign in again to continue.');

export const ownerOnly = () =>
  new ApiError(403, 'owner_only', 'Only the owner can do this. Ask the owner to make this change.');

export const notFound = (what: string) =>
  new ApiError(404, 'not_found', `That ${what} no longer exists. Go back and refresh the list.`);
