// zod schemas for every API input. The Worker validates with these; the web app
// only imports their inferred types.
import { z } from 'zod';
import { OPENROUTER_MODEL_IDS } from './aiModels';
import { BREW_LIMITS } from './limits';
import { COACH_RULES_MAX, COMPARE_KINDS, DUEL_CHOICES, EXPORT_PARTS, IMPORT_CHUNK_MAX, METHODS, READINESS_VERDICTS, TIPS_SUBJECTS } from './types';

export const PIN_PATTERN = /^\d{4,8}$/;

export const pin = z.string().regex(PIN_PATTERN, 'PINs are 4 to 8 digits.');

const personName = z
  .string()
  .trim()
  .min(1, 'Enter a name.')
  .max(40, 'Names can be up to 40 characters.');

const teamName = z
  .string()
  .trim()
  .min(1, 'Enter a team name.')
  .max(60, 'Team names can be up to 60 characters.');

// Up to 100 characters so IDs preserved from the v1 app always fit.
const id = z.string().min(1).max(100);

export const setupInput = z
  .object({
    team_name: teamName,
    owner_name: personName,
    owner_pin: pin,
    team_pin: pin,
  })
  .refine((v) => v.owner_pin !== v.team_pin, {
    message: 'The owner PIN and the team PIN must be different.',
    path: ['team_pin'],
  });
export type SetupInput = z.input<typeof setupInput>;

export const loginInput = z.object({
  member_id: id,
  pin: z.string().regex(/^\d{1,12}$/, 'Enter your PIN using the number keys.'),
});
export type LoginInput = z.input<typeof loginInput>;

export const addMemberInput = z.object({ name: personName });
export type AddMemberInput = z.input<typeof addMemberInput>;

export const updateMemberInput = z.object({ active: z.boolean() });
export type UpdateMemberInput = z.input<typeof updateMemberInput>;

export const setPinInput = z.object({ pin });
export type SetPinInput = z.input<typeof setPinInput>;

// ---------- Shared field helpers ----------

const DATE = /^\d{4}-\d{2}-\d{2}$/;

/** A real calendar date in YYYY-MM-DD (rejects 2026-02-31). */
const isRealDate = (v: string) => {
  const d = new Date(`${v}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === v;
};

const blankToNull = (v: unknown) => (typeof v === 'string' && v.trim() === '' ? null : v);

/** Optional free text: trimmed, blank becomes null. */
const text = (max: number) =>
  z.preprocess(blankToNull, z.string().trim().max(max, `Keep this under ${max} characters.`).nullable()).optional();

const optionalDate = z
  .preprocess(
    blankToNull,
    z
      .string()
      .regex(DATE, 'Use a date like 2026-09-01.')
      .refine(isRealDate, 'That date doesn’t exist. Check the day and month.')
      .nullable(),
  )
  .optional();

const measure = (label: string, min: number, max: number) =>
  z
    .number({ error: `${label} must be a number.` })
    .min(min, `${label} must be at least ${min}.`)
    .max(max, `${label} must be ${max} or less.`)
    .nullable()
    .optional();

const seconds = (label: string, max: number) =>
  z
    .number({ error: `${label} must be a time.` })
    .int(`${label} must be whole seconds.`)
    .min(0, `${label} can’t be negative.`)
    .max(max, `${label} must be ${Math.floor(max / 60)}:${String(max % 60).padStart(2, '0')} or less.`)
    .nullable()
    .optional();

// ---------- Beans ----------

export const beanInput = z.object({
  name: z.string().trim().min(1, 'Give the bean a name.').max(80, 'Keep the name under 80 characters.'),
  roaster: text(80),
  origin: text(80),
  variety: text(80),
  process: text(60),
  roast_level: text(40),
  roast_date: optionalDate,
  altitude: text(40),
  density_notes: text(200),
  notes: text(2000),
  /** Only the owner can change this. */
  is_competition_coffee: z.boolean().optional(),
});
export type BeanInput = z.input<typeof beanInput>;

// ---------- Recipes ----------

const recipeFields = z.object({
  name: text(80),
  bean_id: id.nullable().optional(),
  method: z.enum(METHODS, { error: 'Pick Inverted or Standard.' }),
  filter: text(60),
  dose_g: measure('Dose', 1, 100),
  water_g: measure('Water', 1, 1000),
  temp_c: measure('Temperature', 40, 100),
  grinder: text(60),
  grind_setting: text(40),
  water_recipe: text(120),
  bloom_water_g: measure('Bloom water', 0, 1000),
  bloom_ends_s: seconds('Bloom end', 600),
  agitation: text(200),
  press_starts_s: seconds('Press start', 900),
  press_duration_s: seconds('Press duration', 600),
  bypass_g: measure('Bypass', 0, 1000),
  bypass_temp: text(40),
  other_steps: text(2000),
  notes: text(4000),
});

const pressAfterBloom = (v: { bloom_ends_s?: number | null; press_starts_s?: number | null }) =>
  v.bloom_ends_s == null || v.press_starts_s == null || v.press_starts_s >= v.bloom_ends_s;
const pressAfterBloomIssue = { message: 'The press can’t start before the bloom ends.', path: ['press_starts_s'] };

/** New recipe, or a clone when parent_id is set. */
export const recipeInput = recipeFields.extend({ parent_id: id.nullable().optional() }).refine(pressAfterBloom, pressAfterBloomIssue);
export type RecipeInput = z.input<typeof recipeInput>;

/** Full replacement of an existing recipe's fields (lineage and code never change). */
export const recipeUpdate = recipeFields.refine(pressAfterBloom, pressAfterBloomIssue);
export type RecipeUpdate = z.input<typeof recipeUpdate>;

export const recipeLockInput = z.object({ locked: z.boolean() });

// ---------- Team settings and backup ----------

export const AI_BUDGET_MAX_USD = 1000;

/** Owner's settings form: everything is sent each time (a full replacement). */
export const teamSettingsInput = z.object({
  name: teamName,
  champ_name: text(120),
  champ_date: optionalDate,
  comp_coffee_notes: text(2000),
  ai_monthly_budget_usd: z
    .number({ error: 'Enter the budget in dollars, like 10.' })
    .min(0, 'The budget can’t be negative.')
    .max(AI_BUDGET_MAX_USD, `Keep the budget at $${AI_BUDGET_MAX_USD} or less.`),
  ai_coach_model: z.enum(OPENROUTER_MODEL_IDS, { error: 'Pick a model from the list.' }).nullable().optional(),
  ai_quick_model: z.enum(OPENROUTER_MODEL_IDS, { error: 'Pick a model from the list.' }).nullable().optional(),
  ai_auto_tips: z.boolean({ error: 'Turn automatic tips on or off.' }).optional(),
  /** Left out: keep what's saved. Blank: no house rules. */
  coach_rules: text(COACH_RULES_MAX),
});
export type TeamSettingsInput = z.input<typeof teamSettingsInput>;

export const exportQuery = z.object({
  part: z.enum(EXPORT_PARTS),
  /** Resume after this row key (the previous page's `next`). */
  after: z.string().max(200).optional(),
});

// ---------- v1 import (records arrive already mapped to v2 columns) ----------

const loose = (max: number) => z.string().max(max).nullable();
const amount = z.number().min(0).max(1_000_000).nullable();
const wholeSeconds = z.number().int().min(0).max(86_400).nullable();
const score = z.number().min(0).max(10).nullable();
const timestamp = z.number().int().min(0).max(8.64e15);
const votes = z.number().int().min(0).max(50);

export const importBean = z.object({
  id,
  name: z.string().min(1).max(200),
  roaster: loose(200),
  origin: loose(200),
  variety: loose(200),
  process: loose(200),
  roast_level: loose(100),
  roast_date: z.string().regex(DATE).nullable(),
  altitude: loose(100),
  density_notes: loose(1000),
  notes: loose(10_000),
  is_competition_coffee: z.boolean(),
  created_at: timestamp,
  updated_at: timestamp,
});
export type ImportBean = z.output<typeof importBean>;

export const importRecipe = z.object({
  id,
  code: z.string().min(1).max(20).nullable(),
  name: loose(200),
  parent_id: id.nullable(),
  bean_id: id.nullable(),
  method: z.enum(METHODS),
  filter: loose(200),
  dose_g: amount,
  water_g: amount,
  temp_c: amount,
  grinder: loose(200),
  grind_setting: loose(100),
  water_recipe: loose(500),
  bloom_water_g: amount,
  bloom_ends_s: wholeSeconds,
  agitation: loose(1000),
  press_starts_s: wholeSeconds,
  press_duration_s: wholeSeconds,
  bypass_g: amount,
  bypass_temp: loose(100),
  other_steps: loose(10_000),
  notes: loose(10_000),
  locked: z.boolean(),
  created_at: timestamp,
  updated_at: timestamp,
});
export type ImportRecipe = z.output<typeof importRecipe>;

export const importBrew = z.object({
  id,
  recipe_id: id.nullable(),
  bean_id: id.nullable(),
  grind_used: loose(100),
  total_time_s: wholeSeconds,
  tds_pct: z.number().min(0).max(30).nullable(),
  beverage_g: amount,
  ey_pct: z.number().min(0).max(100).nullable(),
  sweetness: score,
  acidity: score,
  body: score,
  clarity: score,
  finish: score,
  overall: score,
  notes: loose(10_000),
  created_at: timestamp,
});
export type ImportBrew = z.output<typeof importBrew>;

export const importDuel = z.object({
  id,
  recipe_x_id: id,
  recipe_y_id: id,
  bean_id: id.nullable(),
  /** null means a draw. */
  winner_recipe_id: id.nullable(),
  x_votes: votes,
  y_votes: votes,
  judge_count: votes,
  notes: loose(10_000),
  created_at: timestamp,
  revealed_at: timestamp,
});
export type ImportDuel = z.output<typeof importDuel>;

export const importSettings = z.object({
  champ_name: loose(120),
  champ_date: z.string().regex(DATE).nullable(),
  comp_coffee_notes: loose(4000),
});
export type ImportSettings = z.output<typeof importSettings>;

export const importRequest = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('beans'), records: z.array(importBean).max(IMPORT_CHUNK_MAX) }),
  z.object({ kind: z.literal('recipes'), records: z.array(importRecipe).max(IMPORT_CHUNK_MAX) }),
  z.object({ kind: z.literal('brews'), records: z.array(importBrew).max(IMPORT_CHUNK_MAX) }),
  z.object({ kind: z.literal('duels'), records: z.array(importDuel).max(IMPORT_CHUNK_MAX) }),
  z.object({ kind: z.literal('settings'), settings: importSettings }),
]);
export type ImportRequest = z.input<typeof importRequest>;

export const recipeListQuery = z.object({
  scope: z.enum(['mine', 'all']).optional(),
  bean: id.optional(),
});
export type RecipeListQuery = z.input<typeof recipeListQuery>;

// ---------- Brews ----------

/** IDs a phone makes for a brew it may have to queue offline, so retries never duplicate it. */
export const CLIENT_ID_PATTERN = /^[A-Za-z0-9_-]{16,40}$/;

const brewScore = (label: string) =>
  z
    .number({ error: `${label} must be a number.` })
    .min(1, `${label} is between 1 and 10.`)
    .max(10, `${label} is between 1 and 10.`)
    .multipleOf(0.5, `${label} goes in half steps, like 7 or 7.5.`)
    .nullable()
    .optional();

export const brewInput = z.object({
  id: z.string().regex(CLIENT_ID_PATTERN, 'This brew has a bad id. Log it again.').optional(),
  /** Who logged it on the phone. A queued brew must not land on whoever is signed in by the time it syncs. */
  member_id: id.optional(),
  recipe_id: id,
  bean_id: id.nullable().optional(),
  grind_used: text(40),
  total_time_s: seconds('Total time', BREW_LIMITS.total_time_s.max),
  tds_pct: measure('TDS', BREW_LIMITS.tds_pct.min, BREW_LIMITS.tds_pct.max),
  beverage_g: measure('Beverage weight', BREW_LIMITS.beverage_g.min, BREW_LIMITS.beverage_g.max),
  sweetness: brewScore('Sweetness'),
  acidity: brewScore('Acidity'),
  body: brewScore('Body'),
  clarity: brewScore('Clarity'),
  finish: brewScore('Finish'),
  overall: brewScore('Overall'),
  notes: text(2000),
  /** When the brew happened, for logs synced later. Ignored if implausible. */
  brewed_at: z.number().int().positive().optional(),
});
export type BrewInput = z.input<typeof brewInput>;

// ---------- Duels ----------

/** Blind judging needs someone to pour (or host), so 1 to 3 judges who aren't the creator. */
export const DUEL_MAX_JUDGES = 3;

const judgeIds = z
  .array(id, { error: 'Pick the judges.' })
  .min(1, 'Pick at least one judge.')
  .max(DUEL_MAX_JUDGES, `Pick up to ${DUEL_MAX_JUDGES} judges.`);

/** Two recipes, one person pouring both cups. */
const recipeDuelInput = z
  .object({
    kind: z.literal('recipes'),
    recipe_a_id: id,
    recipe_b_id: id,
    bean_id: id.nullable().optional(),
    judge_ids: judgeIds,
    notes: text(500),
  })
  .refine((v) => v.recipe_a_id !== v.recipe_b_id, { message: 'Pick two different recipes.', path: ['recipe_b_id'] });

/** Two baristas, each brewing their own recipe (the same recipe is fine: then it's all technique). */
const baristaDuelInput = z
  .object({
    kind: z.literal('baristas'),
    barista_a_id: z.string({ error: 'Pick both baristas.' }).min(1, 'Pick both baristas.').max(100),
    recipe_a_id: z.string({ error: 'Pick each barista’s recipe.' }).min(1, 'Pick each barista’s recipe.').max(100),
    barista_b_id: z.string({ error: 'Pick both baristas.' }).min(1, 'Pick both baristas.').max(100),
    recipe_b_id: z.string({ error: 'Pick each barista’s recipe.' }).min(1, 'Pick each barista’s recipe.').max(100),
    bean_id: id.nullable().optional(),
    judge_ids: judgeIds,
    notes: text(500),
  })
  .refine((v) => v.barista_a_id !== v.barista_b_id, { message: 'Pick two different baristas.', path: ['barista_b_id'] });

/** A duel without a kind is a recipe duel (what older versions of the app send). */
export const duelInput = z.preprocess(
  (v) => (v && typeof v === 'object' && !('kind' in v) ? { ...v, kind: 'recipes' } : v),
  z.discriminatedUnion('kind', [recipeDuelInput, baristaDuelInput], { error: 'Pick a recipe duel or a barista duel.' }),
);
export type DuelInput = z.input<typeof recipeDuelInput> | z.input<typeof baristaDuelInput>;

const judgeScore = z
  .number({ error: 'Score every criterion for both cups, from 1 to 10.' })
  .min(1, 'Scores go from 1 to 10.')
  .max(10, 'Scores go from 1 to 10.')
  .multipleOf(0.5, 'Scores go in half steps, like 7 or 7.5.');

export const cupScoresInput = z.object({
  sweetness: judgeScore,
  acidity: judgeScore,
  body: judgeScore,
  clarity: judgeScore,
  finish: judgeScore,
  overall: judgeScore,
});

/** A judge scores both cups on every criterion, then points at the better one (or can't separate). */
export const duelVoteInput = z.object({
  choice: z.enum(DUEL_CHOICES, { error: 'Vote X, Y or can’t separate.' }),
  scores: z.object(
    { x: cupScoresInput, y: cupScoresInput },
    { error: 'Score both cups before you vote. No score sheet on your screen? Reload the app to update it.' },
  ),
});
export type DuelVoteInput = z.input<typeof duelVoteInput>;

// ---------- AI coach: inputs ----------

export const planInput = z.object({
  /** Optional recipe to build the session around. */
  recipe_id: id.nullable().optional(),
  focus: text(300),
});

export const adaptInput = z.object({
  bean_id: id,
  recipe_id: id,
});

export const askInput = z.object({
  question: z.string({ error: 'Type a question.' }).trim().min(1, 'Type a question.').max(1000, 'Keep the question under 1000 characters.'),
  /** The bean or recipe the question is about ("Ask the coach about this"). */
  about: z.object({ kind: z.enum(TIPS_SUBJECTS), id }).optional(),
});
export type AskInput = z.input<typeof askInput>;

/** Write the coach's tips on a bean or recipe. Without `refresh`, tips already written are kept. */
export const tipsInput = z.object({
  refresh: z.boolean().optional(),
  /** When the one this phone shows was written: a newer one is returned instead of paying again. */
  seen: z.number().int().min(0).nullable().optional(),
});
export type TipsInput = z.input<typeof tipsInput>;

/** One side of a comparison. A plain id is a team recipe (what older versions of the app send). */
const compareRef = z.union([
  z.object({ kind: z.enum(COMPARE_KINDS), id }),
  id.transform((value) => ({ kind: 'recipe' as const, id: value })),
]);

/** Explain two recipes' differences. Without `refresh`, an explanation already kept is returned. */
export const compareInput = z
  .object({ a: compareRef, b: compareRef, refresh: z.boolean().optional(), seen: z.number().int().min(0).nullable().optional() })
  .refine((v) => v.a.kind !== v.b.kind || v.a.id !== v.b.id, { message: 'Pick two different recipes.', path: ['b'] });
export type CompareInput = z.input<typeof compareInput>;

/** GET /api/coach/compare?a=&b=: each side as "recipe:<id>" or "champion:<id>". */
export const compareQuery = z.object({
  a: z.string().min(1).max(120),
  b: z.string().min(1).max(120),
});

/** Break down a champion recipe. Without `refresh`, a breakdown already kept is returned. */
export const explainInput = z.object({
  refresh: z.boolean().optional(),
  /** When the one this phone shows was written: a newer one is returned instead of paying again. */
  seen: z.number().int().min(0).nullable().optional(),
});
export type ExplainInput = z.input<typeof explainInput>;

export const quickLogInput = z.object({
  text: z.string({ error: 'Type or say the brew first.' }).trim().min(1, 'Type or say the brew first.').max(1000, 'Keep it under 1000 characters.'),
  /** The recipe the log was opened from, as a hint. */
  recipe_id: id.optional(),
});

// ---------- AI coach: model output (validated in the Worker, retried once if invalid) ----------

// The model sometimes writes 88 as "88" or a grind of 22 as a number; accept those, nothing else.
const numeric = (v: unknown) => (typeof v === 'string' && v.trim() !== '' && Number.isFinite(Number(v)) ? Number(v) : v);
const textual = (v: unknown) => (typeof v === 'number' ? String(v) : v);
const aiText = (max: number) => z.string().trim().min(1).max(max);
const changeText = (max: number) => z.preprocess(textual, z.string().trim().max(max).nullable());
const changeNumber = (min: number, max: number) => z.preprocess(numeric, z.number().min(min).max(max).nullable());
const changeSeconds = (max: number) => z.preprocess(numeric, z.number().int().min(0).max(max).nullable());

/** The recipe columns an experiment may change. Unknown keys are dropped. */
export const recipeChanges = z
  .object({
    name: changeText(80),
    bean_id: changeText(100),
    method: z.preprocess((v) => (typeof v === 'string' ? (METHODS.find((m) => m.toLowerCase() === v.trim().toLowerCase()) ?? v) : v), z.enum(METHODS)),
    filter: changeText(60),
    dose_g: changeNumber(1, 100),
    water_g: changeNumber(1, 1000),
    temp_c: changeNumber(40, 100),
    grinder: changeText(60),
    grind_setting: changeText(40),
    water_recipe: changeText(120),
    bloom_water_g: changeNumber(0, 1000),
    bloom_ends_s: changeSeconds(600),
    agitation: changeText(200),
    press_starts_s: changeSeconds(900),
    press_duration_s: changeSeconds(600),
    bypass_g: changeNumber(0, 1000),
    bypass_temp: changeText(40),
    other_steps: changeText(2000),
    notes: changeText(4000),
  })
  .partial();

export const RECIPE_CHANGE_KEYS = Object.keys(recipeChanges.shape);

export const experimentOutput = z.object({
  title: aiText(120),
  parent: z.preprocess(textual, z.string().trim().max(40).nullable()),
  changes: recipeChanges,
  why: aiText(800),
  listenFor: aiText(600),
});

export const experimentsOutput = z.object({
  read: aiText(3000),
  experiments: z.array(experimentOutput).length(3, 'Return exactly 3 experiments.'),
});

export const readinessOutput = z.object({
  verdict: z.enum(READINESS_VERDICTS),
  biggestRisk: aiText(800),
  fixes: z.array(aiText(600)).length(3, 'Return exactly 3 fixes.'),
  evidence: aiText(2000),
});

export const todayOutput = z.object({
  summary: aiText(600),
  duels: z
    .array(z.object({ a: aiText(40), b: aiText(40), why: aiText(400) }))
    .max(3, 'Suggest at most 3 duels.'),
});

export const duelReadOutput = z.object({
  read: aiText(1500),
  next_test: experimentOutput.nullable(),
});

/** A list the card shows at most `max` of: extra items are dropped rather than paid for with a retry. */
const upTo = <T extends z.ZodType>(item: T, max: number) => z.array(item).transform((items) => items.slice(0, max));

export const beanTipsOutput = z.object({
  summary: aiText(1200),
  tips: upTo(aiText(500), 4).refine((tips) => tips.length > 0, 'Give 2 to 4 tips.'),
  start: experimentOutput.nullable(),
});

export const recipeTipsOutput = z.object({
  verdict: aiText(800),
  tips: upTo(z.object({ title: aiText(120), detail: aiText(700) }), 4).refine((tips) => tips.length > 0, 'Give 2 to 4 tips.'),
  checks: upTo(aiText(400), 3),
  next_test: experimentOutput.nullable(),
});

/** A setting's value as the coach quotes it ("92 °C", "none"); never worth a retry. */
const aiValue = z
  .preprocess(textual, z.string().trim())
  .catch('')
  .transform((v) => v.slice(0, 200));

export const compareOutput = z.object({
  summary: aiText(1200),
  changes: upTo(
    z.object({ setting: aiText(100), from: aiValue, to: aiValue, why: aiText(700), how: aiText(700), cup: aiText(500) }),
    8,
  ),
  verdict: aiText(900),
  next: aiText(700),
});

export const championBreakdownOutput = z.object({
  summary: aiText(1200),
  choices: upTo(z.object({ setting: aiText(100), value: aiValue, why: aiText(700), how: aiText(700) }), 8).refine(
    (choices) => choices.length > 0,
    'List the settings that matter.',
  ),
  lessons: upTo(aiText(500), 4).refine((lessons) => lessons.length > 0, 'Give 2 to 4 lessons.'),
});

// A quick log never fails on one odd field: anything unreadable becomes null ("leave it empty").
const maybe = <T extends z.ZodType>(schema: T) => z.preprocess(numeric, schema.nullable()).catch(null);
const maybeText = (max: number) => z.preprocess(textual, z.string().trim().max(max).nullable()).catch(null);
const match = z
  .object({ id: z.string().max(100).nullable(), confidence: z.preprocess(numeric, z.number().min(0).max(1)) })
  .catch({ id: null, confidence: 0 });

export const quickLogOutput = z.object({
  grind_used: maybeText(40),
  total_time_s: maybe(z.number().int().min(1).max(BREW_LIMITS.total_time_s.max)),
  tds_pct: maybe(z.number().min(BREW_LIMITS.tds_pct.min).max(BREW_LIMITS.tds_pct.max)),
  beverage_g: maybe(z.number().min(BREW_LIMITS.beverage_g.min).max(BREW_LIMITS.beverage_g.max)),
  sweetness: maybe(z.number().min(1).max(10).multipleOf(0.5)),
  acidity: maybe(z.number().min(1).max(10).multipleOf(0.5)),
  body: maybe(z.number().min(1).max(10).multipleOf(0.5)),
  clarity: maybe(z.number().min(1).max(10).multipleOf(0.5)),
  finish: maybe(z.number().min(1).max(10).multipleOf(0.5)),
  overall: maybe(z.number().min(1).max(10).multipleOf(0.5)),
  notes: maybeText(2000),
  recipeMatch: match,
  beanMatch: match,
});
