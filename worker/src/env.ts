import type { Role } from '../../shared/types';

declare global {
  namespace Cloudflare {
    interface Env {
      DB: D1Database;
      ASSETS: Fetcher;
      /** Wrangler secret. Only ever read inside the Worker. */
      ANTHROPIC_API_KEY?: string;
    }
  }
}

export type Env = Cloudflare.Env;

/** The signed-in member, resolved from the session cookie on every /api request. */
export interface AuthMember {
  id: string;
  team_id: string;
  name: string;
  role: Role;
  session_id: string;
}

export interface AppEnv {
  Bindings: Env;
  Variables: { member: AuthMember };
}
