# AeroPress Lab (Team Edition)

Championship prep for the Jordan AeroPress Championship. The team logs beans, recipes and brews,
ranks recipes in blind duels (Elo), watches progress on the Board, and gets coaching from Claude.

One Cloudflare Worker serves the API (Hono + D1) and the web app (Vite + React, installable).

## Owner's guide

**Open the app.** In Cloudflare, go to **Workers & Pages › aero-press** and use its address
(`https://aero-press.<your-subdomain>.workers.dev`). To use your own domain instead, open
**Settings › Domains & Routes › Add › Custom domain** there and enter, for example,
`lab.yourdomain.com`.

**Install it on a phone.**
- iPhone: open the address in Safari, tap **Share**, then **Add to Home Screen**.
- Android: open it in Chrome, open the **⋮** menu, then tap **Install app**.

Once opened online, the brew timer and brew log work without a connection.

**Add a member.** Go to **Settings › Members › Add a barista** and type their name. They sign in
by tapping their name and entering the team PIN.

**Reset a PIN.** Go to **Settings › Members**, tap the person, then **Reset PIN**:
- Enter a new PIN of 4 to 8 digits.
- They sign in with that personal PIN from then on, and their other phones are signed out.
- **Use the team PIN again** puts them back on the team PIN.
- For your own owner PIN, tap your name in the same list.
- To change the team PIN for everyone, use **Settings › Change team PIN**.
- After 5 wrong PINs, a name locks for 15 minutes. A PIN reset unlocks it straight away.

**Change the AI budget.** Go to **Settings › Team and championship**, set **AI budget per month
(USD)** and tap **Save**.
- The Board and the Coach tab show this month's spend against the budget.
- When the budget is used up, the coach stops for everyone until the 1st of next month (Amman
  time) or until you raise it.
- The same screen has the championship name and date (the Board counts down to it) and the
  competition coffee notes.

**Turn on the AI coach (once).** The coach works with an OpenRouter key (any of several models)
or an Anthropic key (Claude). If both are set, OpenRouter is used.
1. Create a key at [openrouter.ai](https://openrouter.ai) (Keys) and add some credits there.
2. In Cloudflare, go to **Workers & Pages › aero-press › Settings › Variables and Secrets ›
   Add**. Choose type **Secret**, name it `OPENROUTER_API_KEY`, paste the key, and deploy.
   (For Claude directly instead, use the name `ANTHROPIC_API_KEY` with a key from
   [console.anthropic.com](https://console.anthropic.com).)
3. Pick the models in **Settings › Team and championship › AI coach**:
   - **Coach model:** plans, reads and questions.
   - **Quick model:** quick log and brew notes.
   - Each option shows its price per million tokens. The default is Gemini 3.8 Flash.
   - Switching is instant, so you can try a few models on your own data and keep the one whose
     advice you like.

The key stays in Cloudflare and never reaches anyone's phone. Until it's added, the rest of the
app works and the Coach tab says the coach isn't set up.

**Where the coach helps.** Once the key is in, the coach works across the app, not only in the
Coach tab:
- **A new coffee:** its page opens with what to expect in the cup, brewing tips, and a starting
  recipe built from your best one (**Create as new recipe**).
- **A new recipe, clone or champion recipe:** a review with tips, things to check before duelling
  it, and one next test.
- **Update tips** writes new ones, for example after an edit. **Ask the coach** opens the Coach
  tab with a question about that coffee or recipe.
- **Comparisons explained simply:** on a newer version of a recipe, tap **What changed from …?**,
  or use **Compare** on any recipe. For each difference, the coach says why you'd do it, how it
  works and what you'll taste, then whether the new one is likely better. You can compare with the
  World champion recipes too, or two champions with each other.
- **World champion recipes:** **Explain this recipe** breaks down why the champion likely chose
  each setting and what the team can take from it. **Compare with our recipes** puts it next to
  yours.
- Explanations are kept for the whole team, so the next person sees them without another call.
  **Explain again** writes a new one, for example after a recipe changes.
- **After each brew and each duel:** a short read of the result. **Brew › Quick log** fills in the
  brew form from a sentence.
- **Coach tab:** today's duels, a session plan, adapting a recipe to a new coffee, a readiness
  report, and any question.

Each of these is one AI call from the monthly budget. New coffees and recipes are reviewed
automatically the first time someone opens them. To review only on request, switch off
**Automatic coach tips** in **Settings › Team and championship › AI coach**.

**What the coach knows.** Every answer starts from a coffee reference built into the app:
- The World AeroPress Championship rules: the 5 minutes, the 18 g dose cap, the brewer, the water
  and the 150 ml minimum.
- The numbers from every published podium recipe.
- Checked coffee science: extraction, water temperature (including altitude in Amman and at the
  2026 final in Mexico City), grind, water, beans, processing, roast and rest, tasting and judging,
  and a fix-the-cup guide.

The coach is told to give a reason for every number it suggests, tied to your coffee and your
results. Read the whole reference, with its sources, in **Coach › What the coach knows**.

**House rules.** In **Settings › Team and championship › AI coach**, write what the coach must
always respect. For example: "Our kettle holds 85–100 °C. Grinder: Comandante C40, in clicks. We
brew inverted." Every coach answer follows them, and everyone sees them on the reference page.

**Run a barista duel.** Go to **Duel › Start a duel › Barista duel**:
- Pick the two baristas, the recipe each one brews (both can brew the same one), the coffee, and
  1 to 3 judges.
- You host: your phone shows whose cup goes on X and whose on Y. The baristas see only what to
  brew, and the judges see nothing until the reveal.
- Each judge scores both cups from 1 to 10 on sweetness, acidity, body, clarity, finish and
  overall, then points at the better cup. The votes decide the winner, and the scores show why.
- The Duel tab ranks the baristas. Recipe duels, where one person pours two recipes, still rank
  the recipes. Every duel now uses the same score sheet.

**Back up your data.** Go to **Settings › Download backup**. The phone saves one JSON file with
the beans, recipes, brews, duels, votes, readiness reports and AI usage. It leaves out PINs and
sign-ins. Keep a copy somewhere safe, for example once a week and before the championship.

**Bring in the old app's data.** Go to **Settings › Import v1 backup** and pick the file the old
app exported. Importing twice is safe.

**Start from a champion's recipe.** Go to **Recipes › World champion recipes** for the
published World AeroPress Championship podium recipes from 2009 to 2025, each with its sources.
**Add to our recipes** opens a new recipe with those settings.

## Deploying

Every push to this repository's branch deploys through Cloudflare Workers Builds to the Worker
`aero-press`.
- The first deploy creates the `aeropress-lab` D1 database, or reuses one with that name.
- The app creates and updates its own tables the first time it needs them, so the default deploy
  command (`npx wrangler deploy`) is enough.
- The deploy command can also be `npm run deploy` (**Workers & Pages › aero-press › Settings ›
  Build**), which applies database updates during the deploy instead.

Right after the first deploy, open the site and complete the team setup. Until someone does, the
setup screen is open to anyone who has the link.

To deploy from your own computer instead, run `npx wrangler login` and then `npm run deploy`.

## Running it on a computer

You need Node.js 22.12 or newer.

```bash
npm install
npm run dev          # http://localhost:8787 (first visit shows the team setup)
npm run dev:lan      # the same, reachable from phones on your Wi-Fi at http://<computer-ip>:8787
```

Over plain http on the Wi-Fi, sign-in, the timer and logging work. Offline mode, keeping the
screen awake and installing need https: use the deployed app, or `http://localhost:8787` on the
computer itself.

For the AI coach locally, copy `.dev.vars.example` to `.dev.vars` and put your OpenRouter (or Anthropic) key there.
`test/fixtures/v1-backup.json` is a made-up v1 backup for trying the import.

| Command | What it does |
| --- | --- |
| `npm run dev` | Build, migrate the local database, serve on http://localhost:8787 |
| `npm run dev:lan` | Same, reachable from phones on your network |
| `npm run dev:web` | Hot-reloading UI on :5173 (run `npm run dev` alongside for the API) |
| `npm test` | Unit tests, plus API tests inside the Workers runtime with a real D1 |
| `npm run typecheck` | Strict TypeScript for the Worker, the web app and tooling |
| `npm run db:reset` | Delete the local database and re-apply migrations |
| `npm run gen:migrations` | Rebuild the migrations bundle after changing `migrations/` |
| `npm run deploy` | Build, deploy to Cloudflare, then apply migrations to the live database |

```
migrations/     D1 schema (SQL); the Worker also applies them itself when needed
worker/src/     Hono API: routes, auth, D1 access, AI coach (worker/src/ai)
worker/test/    API tests (Workers runtime + D1)
web/src/        React app; every UI string is in web/src/strings.ts
shared/         Types, zod input schemas, formulas, Elo, champion recipes
test/unit/      Pure-function tests
```
