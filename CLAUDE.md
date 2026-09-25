# AeroPress Lab (Team Edition): working notes

The product brief is the user's build spec (sections 1 to 10). The user works in 7 phases and
tests working screens at each checkpoint; they don't review diffs. Stop at each checkpoint.

## Stack (fixed by the brief; don't substitute)
Cloudflare Workers + Hono (TypeScript), D1, Vite + React + TS served as Workers Static Assets
from the same Worker, zod on every API input, Anthropic API from the Worker only
(`claude-sonnet-5` coach, `claude-haiku-4-5-20251001` quick log; model IDs + prices in one config
file), PWA. Router: wouter. Data fetching: TanStack Query. Charts (phase 6): Recharts.

## Commands
- `npm run dev`: build + local migrations + `wrangler dev` on :8787
- `npm test`: vitest projects `unit` (Node) and `worker` (workerd + D1 via @cloudflare/vitest-pool-workers)
- `npm run typecheck`: tsc for `worker/`, `web/`, and root (tooling, shared, test/unit)
- Install with `npm install` / `npm ci` against the lockfile. A lockfile-less resolve crashes npm 10
  (arborist bug); regenerate the lockfile with `npx npm@11 install`.

## Conventions
- API payloads use D1 column names (snake_case) end to end, including AI `changes` keys.
- Timestamps: INTEGER ms since epoch. IDs: `newId()` (21-char nanoid alphabet).
- Every authenticated route: `requireMember` (+ `requireOwner`), and every query scoped by
  `team_id` from `c.get('member')`. Parameterised D1 queries only.
- Errors: throw `ApiError(status, code, message, extra)`. `message` says what happened and what to
  do. The web app maps `code` to its own copy in `strings.errors.byCode` (Arabic-ready).
- All UI strings live in `web/src/strings.ts` (use functions for interpolation, not concatenation).
- Input schemas live in `shared/schemas.ts`; the web app imports only their types.
- No `any` in the API layer. No stack traces to users. Never log request bodies (PINs).
- Worker tests: `freshDb()` in `beforeEach` (reset + migrations); `Client` keeps a cookie.
- `compatibility_date` is 2026-08-20: the test pool's workerd supports up to 2026-08-22.

## Decisions (confirmed or pending with the user)
- Sign-in: baristas use the team PIN (hash on `teams`), the owner uses the owner PIN only.
  "Reset PIN" on a barista sets a personal PIN that replaces the team PIN for them; "Use the team
  PIN again" clears it. Owner PIN must differ from the team PIN.
- Lockout: 5 failures per member in a rolling 15-minute window (`login_attempts.first_failed_at`),
  then 15-minute lock. Successful sign-in or a PIN reset clears it.
- Session cookie `ap_session`: HttpOnly, SameSite=Lax, 30-day fixed expiry, Secure everywhere
  except plain-http local/private-network hosts (so LAN phone testing works in dev).
- Schema additions beyond the brief: `teams.pin_hash/pin_salt`, `login_attempts.first_failed_at`,
  `duel_judges` table, `duels.rematch_of`.
- PBKDF2 100k iterations costs about 25 ms CPU per sign-in. The Workers Free plan caps CPU at 10 ms,
  so production needs Workers Paid unless the user decides otherwise (raised at checkpoint 1).
- This cloud environment's egress blocks api.cloudflare.com; deploying from here needs the network
  policy changed and a `CLOUDFLARE_API_TOKEN` + `CLOUDFLARE_ACCOUNT_ID` in the environment (new session).

## Phase status
1. Skeleton and auth: built (checkpoint 1).
2. Beans, recipes, compare, lineage, v1 import: next.
