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
- Hosting: the user stays on **Workers Free** (decided after checkpoint 1; they have the Cloudflare
  Pro *website* plan, which doesn't include Workers Paid). Free allows 10 ms of CPU per request.
  So PIN hashes use 20k PBKDF2 rounds (`PIN_HASH_ITERATIONS` in `worker/src/config.ts`), a
  deliberate deviation from the brief's 100k: 100k measured ~16 ms per hash in workerd, 20k ~3 ms,
  and setup / owner or team PIN changes hash twice. Stored format is `pbkdf2-sha256$<rounds>$<b64>`;
  bare base64 means legacy 100k. A test caps the constant at 25k. Their Pro domain can host the
  app on a subdomain via a Worker custom domain (phase 7).
- Free-plan design rules for later phases: keep every request well under 10 ms of CPU. Parse the
  v1 import file in the browser and send it in chunks; build exports per table rather than one
  giant JSON.stringify; waiting on D1 or fetch doesn't count as CPU. Mind the daily quotas
  (requests, D1 rows read/written) when designing Elo-on-read and 2-second duel polling.
- Deploys: the user connected the GitHub repo to Cloudflare Workers Builds (Worker `aero-press`).
  The production branch is this repo's only branch, so every push deploys to the live app:
  push only working, tested states.
  - The Worker `name` in wrangler.jsonc must stay `aero-press`.
  - The D1 binding has no `database_id`. `wrangler deploy` inherits the Worker's bound database,
    else uses the account's `aeropress-lab`, else creates it (wrangler 4.140 provisioning, on by
    default).
  - The Worker migrates its own database. When a query fails with "no such table/column",
    `onError` runs `applyPendingMigrations` (worker/src/lib/schema.ts). It applies the bundled
    migrations, one D1 batch each, records them in `d1_migrations` exactly as wrangler does,
    and answers 503 `database_updated`; the app retries reads by itself.
    - This was needed because the dashboard deploy command stayed `npx wrangler deploy`, so the
      first live deploy had no tables.
    - Once per Worker instance, `ensureCurrentSchema` (middleware) also applies bundled
      migrations missing from `d1_migrations`, for changes that never make a query fail (new
      indexes). A database with no `d1_migrations` table is left to the error path.
    - The bundle is `worker/src/migrations.gen.ts`. After adding or changing a migration, run
      `npm run gen:migrations`; a unit test fails if the bundle is stale.
    - `npm run deploy` (build, deploy, `d1 migrations apply --remote`) also works, and each path
      skips what the other applied.
    - Migrations may run after the new code is live, so keep them additive. Keep each
      migration's statement count modest, because a fresh database applies them all in one
      request.
  - This cloud environment's egress blocks api.cloudflare.com, so nothing deploys from here
    directly.

- Beans are shared; anyone edits them. One competition coffee per team, set by the owner only.
- Recipes: any member creates (code = their next R-number, shown as initials-code, e.g. AK-R3) or
  clones (parent_id). Author or owner edits; the edit form warns when brews/duels exist and offers
  "Clone instead". One locked (competition) recipe per team; owner-only; locked = read-only.
- Elo is computed on read from revealed duels (shared/elo.ts). The bean filter lists recipes on
  that bean or duelled on it, rated on that bean's duels only. The list API returns full recipe
  rows, so compare and lineage are computed in the browser.
- v1 import: the browser maps the file (shared/v1import.ts) and sends chunks of 200 per kind
  (beans, recipes parents-first, brews, duels, settings). The Worker validates with zod, skips
  existing IDs, nulls references it can't satisfy (skips duels missing a recipe), renames
  colliding codes to the owner's next R-number, computes missing EY from the recipe dose, fills
  only empty championship settings, and assigns everything to the owner. Warnings carry a code,
  count and examples; the web app words them. Sample backup: test/fixtures/v1-backup.json.

- Brew plan (`shared/phases.ts`): bloom, steep, flip (10 s, inverted only), press, bypass (15 s,
  if any), pour (15 s). Checked against the 5:00 window `WINDOW_S`. Without a press start or press
  time the plan stops after the bloom (`missing` lists what to add).
- Timer (`web/src/brew/timer.ts`): one app-wide store built on timestamps and saved in localStorage,
  so it survives tab switches and reloads. One brew at a time. Beep plus vibrate on each step
  (iOS: `navigator.audioSession.type='playback'`), and screen wake lock while running.
- Offline:
  - The service worker is generated at build (`web/sw-template.js` + the vite plugin). It
    precaches the shell, serves navigations network-first and assets cache-first, and never
    touches `/api`.
  - A localStorage snapshot of me, recipes and beans (`ap-offline-v1`) is preloaded into the
    query cache.
  - Brews logged offline wait in `ap-brew-queue-v1`, keyed by member, with client IDs.
- POST /api/brews is idempotent: the same id from the same member returns the saved brew, and an
  id owned by anyone else gets 409 `brew_id_taken`. `brewed_at` is kept if it falls between
  30 days back and 5 minutes ahead; otherwise the server uses its own time. The server
  computes EY from the recipe dose; the form only previews it. Scores are 1–10 in half steps, and
  a score nobody touched is saved as null.
- The phone sends `member_id` with every brew. If it isn't the session's member, the server
  answers 409 `wrong_member` and the brew keeps waiting, so a brew logged offline never lands on
  whoever signs in next.
- `failureKind` (brewQueue.ts) is the one rule for failures. Only a refusal of the brew itself is
  final. These keep it waiting:
  - offline, or no answer within 10 s;
  - 401 or `wrong_member`;
  - 5xx, 408 or 429.

  The log form checks the ranges in `shared/limits.ts` (shared with the zod schema) before
  saving, so the server has no reason to refuse a queued brew later.
- Sign-out needs a connection: the phone is cleared only after the server ends the session.
- Timer:
  - A brew left running stops itself 2 minutes after the later of its planned end and 5:00.
  - A timer started more than an hour ago is dropped when the app loads.
  - The clock shows whole seconds, rounded down.
- The signed-in shell prefetches all recipes and beans, so the offline copy has them straight
  after sign-in.
- Navigation: new screens open at the top; Back keeps the browser's scroll restore (`web/src/scroll.ts`).

- Duels (worker/src/routes/duels.ts, lib/duels.ts):
  - A duel is created already `pouring`; the server's coin flip decides which recipe is X.
  - The creator pours, so they can't be a judge. There are 1 to 3 judges, all active members.
  - `ready` moves it to `judging`. Each judge gets one vote, and it can't be changed.
  - The last vote reveals the duel in the same D1 batch, through a conditional UPDATE, so racing
    votes reveal it once. The creator or owner can reveal early once at least one vote is in, or
    cancel.
  - Rematch swaps X and Y and keeps the judges, minus whoever starts it. It's idempotent via
    `rematch_id`.
  - `toDuelView` is the only place a duel becomes a response. Recipe identities and notes go to
    the creator before the reveal, and to everyone after it. Judges' choices appear only after
    the reveal. `worker/test/duels.test.ts` checks raw JSON for leaks.
  - The duel screen polls every 2 s until it's revealed or cancelled. The Duel list polls every
    4 s while open, which is how judges find a new duel or a rematch.
  - The leaderboard (on the Duel tab) is computed in the browser from the recipes list.

- AI (phase 5), all in `worker/src/ai/`:
  - Every call checks the monthly budget first (month-to-date `SUM(cost_usd)` in Amman time, the
    spec's exact message on 402).
  - Then it reserves an `ai_calls` row at its worst-case cost (estimated input plus the full
    `max_tokens`) and corrects it from `usage`:
    - An HTTP error from the API deletes the row (not billed).
    - A timeout or a stream cut off mid-answer keeps the worst case.
    - Cost is priced from `MODELS[kind]`, never from the model name in the reply.
  - Every call streams (`messages.stream().finalMessage()`), because the SDK timeout only covers
    the wait for the first byte, so long answers aren't cut off and retried.
  - JSON replies come from prompt instructions, checked with zod (`shared/schemas.ts`), with one
    retry that quotes the error. Structured outputs aren't used. Sonnet 5 takes
    `output_config.effort`, with no temperature and no prefill.
  - Parent codes resolve to team recipes. A "change" to the parent's own value is dropped.
  - Today's session is cached per member per day in `coach_cache`:
    - A `pending:<ms>` row claims the write, so tabs and phones wait instead of paying twice.
    - A failed write deletes its claim.
    - Below two team recipes there is no call at all.
    - On the phone, the Board and the Coach tab share one attempt per day, with no automatic
      retries.
  - Readiness reports are stored.
    Ask anything streams the SSE straight through, and a meter reads the usage.
  - Quick log (Haiku) returns only ids from the team's lists, else null. The brew log then opens
    prefilled through an in-memory draft (`web/src/drafts.ts`, `draft` URL token).
  - Reads:
    - Brew read: Haiku, in `waitUntil` after the save. The log screen refetches the recipe after 6 s.
    - Duel read: Sonnet (the spec names both Haiku and Sonnet; Sonnet chosen).
      - The first phone to ask claims it (`ai_read = 'pending:<ms>'`, stale after 6 minutes,
        longer than the slowest write). Its final write only lands while the claim holds.
      - The others get 202 and ask again every 3 s.
      - It's automatic for a day after the reveal; older duels get a button.
  - Tests swap the network through `aiTransport`. Local click-throughs can use the same hook
    with a stand-in server; real calls need `ANTHROPIC_API_KEY`.
  - Prices: Sonnet 5 at $2 / $10 per million tokens (the introductory price is now permanent),
    Haiku 4.5 at $1 / $5.

- Champion recipes (`shared/champions.ts`, screens under `/recipes/champions`): WAC podium recipes
  researched from the official WAC and aeropress.com pages plus coffee press (search summaries;
  pages couldn't be opened from here).
  - Values the sources disagree on stay empty, and `caveats` says why. Millilitres are entered as
    grams. Text is shortened to the form's limits, and the full method is in `other_steps`.
  - "Add to our recipes" opens the new-recipe form through a draft (name `WAC <year> <place> ·
    <name>`, and the notes carry the sources).
  - A unit test validates every entry against `recipeInput`.

- Board (phase 6), `GET /api/board[?member=<id>]`:
  - The owner gets the team; `?member` gives one member's own board. Baristas always get their
    own and get 403 for anyone else's.
  - Aggregates (weekly averages, spreads, per-day counts, last activity) run in D1 SQL, and Elo
    over time replays duels through `replayElo`'s `onDuel` hook. Thresholds and date maths are
    in `shared/dashboard.ts` (Amman time).
  - Readiness uses the locked recipe: its wins, the distinct beans across its brews and duels,
    and its latest timed brews. The competition-coffee duel check counts any duel on that bean.
  - Recharts sits in a lazy chunk (`components/BoardCharts.tsx`), and so do the champion screens
    with their data.
  - The Today card also shows on the Board. It stays silent there (`quiet`), and the server
    doesn't call the AI until the team has two recipes.
- Settings: `GET/PUT /api/team` (everyone reads, the owner saves; the budget is rounded to cents).
  Backup: `GET /api/export?part=&after=` for the owner, one table per request in pages of 500,
  never PIN hashes or sessions. The browser builds the single JSON file.
  - Only finished duels (revealed or cancelled), with their judges and votes, are exported. The
    owner can judge, so a live duel stays secret even from them.
- D1 free-plan read budget (5M rows/day):
  - The Board reads about 7k rows per load on a team with 5k brews and 1k duels.
  - One windowed scan of recent brews covers the weekly scores, spreads and activity.
  - Duel activity is bounded to 30 days.
  - Last brews come from `idx_brews_team_member_created`.
  - The Board is cached for 60 s on the phone.
  - Recipe lists skip `brew_count` (null); only the single-recipe fetch counts brews.
- PWA: `web/public/manifest.webmanifest`, icons in `web/public/icons` (rendered from the favicon
  design). The manifest and icons are in the service worker's precache list (`vite.config.ts`).
- The web app must not import runtime values from `shared/schemas.ts` (that would pull zod into
  the bundle). Shared constants live in `shared/types.ts`.

## Phase status
1. Skeleton and auth: built (checkpoint 1, approved).
2. Beans, recipes, compare, lineage, v1 import: built (checkpoint 2, approved).
3. Brew mode and log (timer, offline queue, manual log, EY): built (checkpoint 3, approved).
4. Duels, Elo, leaderboard: built. The user asked to finish all remaining phases without stopping,
   plus a library of World AeroPress Championship recipes.
5. AI coach, quick log, reads: built.
6. Dashboard, settings, export, PWA install: built.
7. Owner README (one-page owner's guide), final checks, review fixes: done. The Anthropic key
   must be added in Cloudflare by the owner; real AI calls couldn't be tested from here.
