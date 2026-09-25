# AeroPress Lab (Team Edition)

Championship prep for the Jordan AeroPress Championship: log beans, recipes and brews,
rank recipes with blind head-to-head duels (Elo), monitor progress, and get AI coaching.

One Cloudflare Worker serves both the API (Hono + D1) and the web app (Vite + React PWA).

> Build status: **Phase 3 of 7** (team and sign-in; beans; recipes with Elo, clone-and-tweak,
> compare, lineage and locking; v1 import; brew timer, brew log with extraction yield, offline brewing).
> The owner's one-page guide (add a member, reset a PIN, AI budget, backups) arrives with the deploy in phase 7.

## Run it on your computer

You need Node.js 22.12 or newer (`node --version` to check).

```bash
npm install
npm run dev
```

Open **http://localhost:8787**. The first visit shows the one-time team setup.

`npm run dev` builds the app, applies database migrations to a local D1 database
(stored in `.wrangler/`), and starts `wrangler dev`. Stop it with Ctrl+C; your data stays.

### Try it on your phone (same Wi-Fi)

```bash
npm run dev:lan
```

Then open `http://<your-computer's-IP>:8787` on the phone (on a Mac: System Settings → Wi-Fi →
Details → IP address). Plain http is fine for sign-in, the brew timer and logging. Browsers
only allow some features over https: working offline, keeping the screen awake, and installing
the app. Those need the deployed version, or `http://localhost:8787` on the computer itself.

### Brewing without a connection

Open the app online once, and after that it works without a connection. The timer runs,
and brews you log wait on the phone ("1 brew is waiting to sync"). They go up by themselves
when the connection comes back. Brews that are still waiting stay on the phone after
sign-out and sync the next time that person signs in there. To try it on the computer, open
Chrome's DevTools, then Network › Offline.

### Import your v1 backup

Sign in as the owner, then **Settings › Import v1 backup** and pick the JSON file the old app
exported. You'll see what's in it before anything is saved, and importing twice is safe.
To try the flow without your own file, use `test/fixtures/v1-backup.json` (made-up sample data).

### Start over with an empty database

```bash
npm run db:reset
```

## Scripts

| Command | What it does |
| --- | --- |
| `npm run dev` | Build, migrate the local database, serve on http://localhost:8787 |
| `npm run dev:lan` | Same, reachable from phones on your network |
| `npm run dev:web` | Hot-reloading UI on :5173 (run `npm run dev` alongside for the API) |
| `npm test` | Unit tests plus API tests inside the Workers runtime with a real D1 |
| `npm run typecheck` | Strict TypeScript for the Worker, the web app and tooling |
| `npm run db:reset` | Delete the local database and re-apply migrations |

## Layout

```
migrations/     D1 schema (SQL), applied with wrangler
worker/src/     Hono API: routes, auth, D1 access
worker/test/    API tests (Workers runtime + D1)
web/src/        React app; every UI string is in web/src/strings.ts
shared/         Types, zod input schemas and pure helpers used by both sides
test/unit/      Pure-function tests
```
