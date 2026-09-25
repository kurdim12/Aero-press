# AeroPress Lab (Team Edition)

Championship prep for the Jordan AeroPress Championship: log beans, recipes and brews,
rank recipes with blind head-to-head duels (Elo), monitor progress, and get AI coaching.

One Cloudflare Worker serves both the API (Hono + D1) and the web app (Vite + React PWA).

> Build status: **Phase 1 of 7** (skeleton, team setup, PIN sign-in, roles, members).
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
Details → IP address). Plain http is fine for sign-in during development. Features that
browsers only allow over https (installing the app, keeping the screen awake) need the deployed version.

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
