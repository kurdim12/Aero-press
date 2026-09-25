// zod schemas for every API input. The Worker validates with these; the web app
// only imports their inferred types.
import { z } from 'zod';
import { BREW_LIMITS } from './limits';
import { IMPORT_CHUNK_MAX, METHODS } from './types';

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
