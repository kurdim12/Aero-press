// Maps a backup exported by the v1 single-page AeroPress Lab onto v2 records.
//
// Runs in the browser: the Worker on the Free plan has 10 ms of CPU per request, so the
// file is parsed and mapped here and sent in small chunks that the Worker validates
// (shared/schemas.ts import* schemas) and inserts. Pure and deterministic, so it's unit tested.

import type { ImportBean, ImportBrew, ImportDuel, ImportRecipe, ImportSettings } from './schemas';
import type { Method } from './types';

export type RecordKind = 'beans' | 'recipes' | 'brews' | 'duels';

export type PlanWarningCode =
  | 'missing_id'
  | 'duplicate_id'
  | 'not_a_record'
  | 'unnamed_bean'
  | 'bad_number'
  | 'bad_time'
  | 'bad_date'
  | 'score_out_of_range'
  | 'method_defaulted'
  | 'lineage_loop'
  | 'parent_not_in_file'
  | 'bean_not_in_file'
  | 'recipe_not_in_file'
  | 'duel_missing_recipe'
  | 'duel_bad_winner';

export interface PlanWarning {
  code: PlanWarningCode;
  kind: RecordKind;
  count: number;
}

export interface IgnoredField {
  kind: RecordKind;
  field: string;
  count: number;
}

export interface V1Plan {
  beans: ImportBean[];
  /** Parents always come before their children. */
  recipes: ImportRecipe[];
  brews: ImportBrew[];
  duels: ImportDuel[];
  settings: ImportSettings | null;
  warnings: PlanWarning[];
  /** Fields in the file that the import doesn't use, with how many records had them. */
  ignoredFields: IgnoredField[];
}

export type V1PlanResult = { ok: true; plan: V1Plan } | { ok: false; error: 'not_v1' | 'wrong_version' };

type Obj = Record<string, unknown>;
const isObj = (v: unknown): v is Obj => typeof v === 'object' && v !== null && !Array.isArray(v);

/** Fields the import reads (or deliberately recomputes), per kind. Anything else is reported. */
const KNOWN: Record<RecordKind, ReadonlySet<string>> = {
  beans: new Set([
    'id', 'name', 'roaster', 'origin', 'variety', 'process', 'roastLevel', 'roastDate', 'altitude',
    'density', 'notes', 'isComp', 't', 'createdAt', 'created', 'updatedAt', 'updated',
  ]),
  recipes: new Set([
    'id', 'code', 'name', 'parentId', 'beanId', 'method', 'filter', 'dose', 'water', 'temp', 'grinder',
    'grind', 'waterRecipe', 'bloomWater', 'bloomTime', 'stirs', 'steepTime', 'pressTime', 'bypass',
    'bypassTemp', 'steps', 'notes', 'locked', 'ratio', 't', 'createdAt', 'created', 'updatedAt', 'updated',
  ]),
  brews: new Set([
    'id', 'recipeId', 'beanId', 'grind', 'time', 'tds', 'bev', 'ey', 'sweetness', 'acidity', 'body',
    'clarity', 'finish', 'overall', 'notes', 't', 'createdAt', 'created',
  ]),
  duels: new Set(['id', 'x', 'y', 'xVotes', 'yVotes', 'winner', 'beanId', 'notes', 't', 'createdAt', 'created']),
};

class Collector {
  private warnings = new Map<string, PlanWarning>();
  private ignored = new Map<string, IgnoredField>();

  warn(kind: RecordKind, code: PlanWarningCode, count = 1): void {
    const key = `${kind}:${code}`;
    const w = this.warnings.get(key);
    if (w) w.count += count;
    else this.warnings.set(key, { kind, code, count });
  }

  noteFields(kind: RecordKind, record: Obj): void {
    for (const field of Object.keys(record)) {
      if (KNOWN[kind].has(field)) continue;
      const key = `${kind}:${field}`;
      const f = this.ignored.get(key);
      if (f) f.count++;
      else this.ignored.set(key, { kind, field, count: 1 });
    }
  }

  result() {
    return { warnings: [...this.warnings.values()], ignoredFields: [...this.ignored.values()] };
  }
}

// ---------- Value readers ----------

function text(v: unknown, max: number): string | null {
  if (typeof v === 'number' && Number.isFinite(v)) return String(v);
  if (typeof v !== 'string') return null;
  const t = v.trim();
  return t ? t.slice(0, max) : null;
}

const BAD = Symbol('bad');
type Parsed<T> = T | null | typeof BAD;

/** A non-negative number; tolerates numeric strings with a unit ("18g", "88°C", "1,32"). */
function amount(v: unknown): Parsed<number> {
  if (v === null || v === undefined || v === '') return null;
  let n: number;
  if (typeof v === 'number') n = v;
  else if (typeof v === 'string') {
    const t = v
      .trim()
      .replace(',', '.')
      .replace(/\s*(grams?|gr|g|ml|°c|°|c|%)$/i, '');
    if (t === '') return null;
    n = Number(t);
  } else return BAD;
  return Number.isFinite(n) && n >= 0 ? n : BAD;
}

/** Seconds from a number, "m:ss" or "45s". */
function duration(v: unknown): Parsed<number> {
  if (v === null || v === undefined || v === '') return null;
  if (typeof v === 'number') return Number.isFinite(v) && v >= 0 ? Math.round(v) : BAD;
  if (typeof v !== 'string') return BAD;
  const t = v.trim();
  const mmss = /^(\d{1,3}):(\d{1,2})(?:\.\d+)?$/.exec(t);
  if (mmss) {
    const s = Number(mmss[2]);
    return s < 60 ? Number(mmss[1]) * 60 + s : BAD;
  }
  const secs = /^(\d+(?:\.\d+)?)\s*(s|sec|secs|seconds)?$/i.exec(t);
  return secs ? Math.round(Number(secs[1])) : BAD;
}

/** Milliseconds since epoch from ms, seconds or an ISO string. */
function timestamp(v: unknown): number | null {
  if (typeof v === 'number' && Number.isFinite(v) && v > 0) return Math.round(v < 1e11 ? v * 1000 : v);
  if (typeof v === 'string' && v.trim()) {
    const ms = Date.parse(v);
    return Number.isNaN(ms) ? null : ms;
  }
  return null;
}

/** YYYY-MM-DD from a date or date-time string. */
function isoDate(v: unknown): Parsed<string> {
  if (v === null || v === undefined || v === '') return null;
  if (typeof v !== 'string') return BAD;
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(v.trim());
  if (!m) return BAD;
  const date = `${m[1]}-${m[2]}-${m[3]}`;
  const d = new Date(`${date}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === date ? date : BAD;
}

function bool(v: unknown): boolean {
  return v === true || v === 1 || v === '1' || (typeof v === 'string' && ['true', 'yes'].includes(v.trim().toLowerCase()));
}

function idOf(v: unknown): string | null {
  if (typeof v === 'number' && Number.isFinite(v)) return String(v);
  if (typeof v !== 'string') return null;
  const t = v.trim();
  return t && t.length <= 100 ? t : null;
}

/** FNV-1a, so a record without an id gets the same id every time the same file is imported. */
function stableHash(input: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < input.length; i++) {
    h ^= input.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(36);
}

function recipeCode(v: unknown): string | null {
  const t = text(v, 40);
  if (!t) return null;
  const m = /^(?:[a-z]{1,4}-)?r(\d+)$/i.exec(t);
  return m ? `R${Number(m[1])}` : t.slice(0, 20);
}

function method(v: unknown): Method | null {
  const t = text(v, 40)?.toLowerCase();
  if (!t) return null;
  if (t.startsWith('inv')) return 'Inverted';
  if (['standard', 'std', 'upright', 'regular', 'normal', 'traditional'].some((w) => t.startsWith(w))) return 'Standard';
  return null;
}

// ---------- Mapping ----------

interface Ctx {
  c: Collector;
  now: number;
}

/** Read a numeric field, counting unreadable values. */
function num(ctx: Ctx, kind: RecordKind, v: unknown, reader: (v: unknown) => Parsed<number> = amount): number | null {
  const r = reader(v);
  if (r === BAD) {
    ctx.c.warn(kind, reader === duration ? 'bad_time' : 'bad_number');
    return null;
  }
  return r;
}

function scoreOf(ctx: Ctx, v: unknown): number | null {
  const r = amount(v);
  if (r === null || r === 0) return null; // 0 meant "not rated" in v1
  if (r === BAD || r > 10) {
    ctx.c.warn('brews', 'score_out_of_range');
    return null;
  }
  return r;
}

function createdAt(ctx: Ctx, r: Obj): number {
  return timestamp(r.t) ?? timestamp(r.createdAt) ?? timestamp(r.created) ?? ctx.now;
}

function recordsOf(ctx: Ctx, kind: RecordKind, list: unknown): Array<{ id: string; r: Obj }> {
  const out: Array<{ id: string; r: Obj }> = [];
  const seen = new Set<string>();
  for (const r of Array.isArray(list) ? list : []) {
    if (!isObj(r)) {
      ctx.c.warn(kind, 'not_a_record');
      continue;
    }
    ctx.c.noteFields(kind, r);
    let id = idOf(r.id);
    if (!id) {
      id = `v1-${kind}-${stableHash(JSON.stringify(r))}`;
      ctx.c.warn(kind, 'missing_id');
    }
    if (seen.has(id)) {
      ctx.c.warn(kind, 'duplicate_id');
      continue;
    }
    seen.add(id);
    out.push({ id, r });
  }
  return out;
}

function mapBean(ctx: Ctx, id: string, r: Obj): ImportBean {
  let name = text(r.name, 200);
  if (!name) {
    name = 'Unnamed bean';
    ctx.c.warn('beans', 'unnamed_bean');
  }
  const roastDate = isoDate(r.roastDate);
  if (roastDate === BAD) ctx.c.warn('beans', 'bad_date');
  const created = createdAt(ctx, r);
  return {
    id,
    name,
    roaster: text(r.roaster, 200),
    origin: text(r.origin, 200),
    variety: text(r.variety, 200),
    process: text(r.process, 200),
    roast_level: text(r.roastLevel, 100),
    roast_date: roastDate === BAD ? null : roastDate,
    altitude: text(r.altitude, 100),
    density_notes: text(r.density, 1000),
    notes: text(r.notes, 10_000),
    is_competition_coffee: bool(r.isComp),
    created_at: created,
    updated_at: timestamp(r.updatedAt) ?? timestamp(r.updated) ?? created,
  };
}

function mapRecipe(ctx: Ctx, id: string, r: Obj): ImportRecipe {
  let m = method(r.method);
  if (!m) {
    m = 'Inverted';
    ctx.c.warn('recipes', 'method_defaulted');
  }
  const created = createdAt(ctx, r);
  return {
    id,
    code: recipeCode(r.code),
    name: text(r.name, 200),
    parent_id: idOf(r.parentId),
    bean_id: idOf(r.beanId),
    method: m,
    filter: text(r.filter, 200),
    dose_g: num(ctx, 'recipes', r.dose),
    water_g: num(ctx, 'recipes', r.water),
    temp_c: num(ctx, 'recipes', r.temp),
    grinder: text(r.grinder, 200),
    grind_setting: text(r.grind, 100),
    water_recipe: text(r.waterRecipe, 500),
    bloom_water_g: num(ctx, 'recipes', r.bloomWater),
    bloom_ends_s: num(ctx, 'recipes', r.bloomTime, duration),
    agitation: text(r.stirs, 1000),
    press_starts_s: num(ctx, 'recipes', r.steepTime, duration),
    press_duration_s: num(ctx, 'recipes', r.pressTime, duration),
    bypass_g: num(ctx, 'recipes', r.bypass),
    bypass_temp: text(r.bypassTemp, 100),
    other_steps: text(r.steps, 10_000),
    notes: text(r.notes, 10_000),
    locked: bool(r.locked),
    created_at: created,
    updated_at: timestamp(r.updatedAt) ?? timestamp(r.updated) ?? created,
  };
}

/** A number no bigger than `max`; larger values count as unreadable. */
function capped(ctx: Ctx, kind: RecordKind, v: unknown, max: number): number | null {
  const n = num(ctx, kind, v);
  if (n !== null && n > max) {
    ctx.c.warn(kind, 'bad_number');
    return null;
  }
  return n;
}

function mapBrew(ctx: Ctx, id: string, r: Obj): ImportBrew {
  return {
    id,
    recipe_id: idOf(r.recipeId),
    bean_id: idOf(r.beanId),
    grind_used: text(r.grind, 100),
    total_time_s: num(ctx, 'brews', r.time, duration),
    tds_pct: capped(ctx, 'brews', r.tds, 30),
    beverage_g: num(ctx, 'brews', r.bev),
    ey_pct: capped(ctx, 'brews', r.ey, 100),
    sweetness: scoreOf(ctx, r.sweetness),
    acidity: scoreOf(ctx, r.acidity),
    body: scoreOf(ctx, r.body),
    clarity: scoreOf(ctx, r.clarity),
    finish: scoreOf(ctx, r.finish),
    overall: scoreOf(ctx, r.overall),
    notes: text(r.notes, 10_000),
    created_at: createdAt(ctx, r),
  };
}

function mapDuel(ctx: Ctx, id: string, r: Obj): ImportDuel | null {
  const x = idOf(r.x);
  const y = idOf(r.y);
  if (!x || !y || x === y) {
    ctx.c.warn('duels', 'duel_missing_recipe');
    return null;
  }
  let winner: string | null;
  const w = typeof r.winner === 'number' ? String(r.winner) : r.winner;
  if (w === '' || w === null || w === undefined) winner = null;
  else if (w === x || w === 'x' || w === 'X') winner = x;
  else if (w === y || w === 'y' || w === 'Y') winner = y;
  else {
    ctx.c.warn('duels', 'duel_bad_winner');
    return null;
  }
  const xVotes = voteCount(r.xVotes);
  const yVotes = voteCount(r.yVotes);
  const at = createdAt(ctx, r);
  return {
    id,
    recipe_x_id: x,
    recipe_y_id: y,
    bean_id: idOf(r.beanId),
    winner_recipe_id: winner,
    x_votes: xVotes,
    y_votes: yVotes,
    judge_count: Math.min(50, xVotes + yVotes),
    notes: text(r.notes, 10_000),
    created_at: at,
    revealed_at: at,
  };
}

/** Whole vote count, 0 when missing or unreadable. */
function voteCount(v: unknown): number {
  const n = amount(v);
  return n === null || n === BAD ? 0 : Math.min(50, Math.round(n));
}

/** Order recipes so every parent precedes its children; break any loop in the lineage. */
function parentsFirst(ctx: Ctx, recipes: ImportRecipe[]): ImportRecipe[] {
  const byId = new Map(recipes.map((r) => [r.id, r]));
  const state = new Map<string, 'visiting' | 'done'>();
  const out: ImportRecipe[] = [];
  const visit = (r: ImportRecipe) => {
    if (state.get(r.id) === 'done') return;
    state.set(r.id, 'visiting');
    const parent = r.parent_id ? byId.get(r.parent_id) : undefined;
    if (parent) {
      if (state.get(parent.id) === 'visiting') {
        r.parent_id = null;
        ctx.c.warn('recipes', 'lineage_loop');
      } else visit(parent);
    }
    state.set(r.id, 'done');
    out.push(r);
  };
  for (const r of recipes) visit(r);
  return out;
}

function mapSettings(meta: unknown): ImportSettings | null {
  const doc = Array.isArray(meta) ? meta.find((m) => isObj(m) && (m.id === 'settings' || m._id === 'settings')) : null;
  if (!isObj(doc)) return null;
  const date = isoDate(doc.champDate);
  const settings: ImportSettings = {
    champ_name: text(doc.champName, 120),
    champ_date: date === BAD ? null : date,
    comp_coffee_notes: text(doc.compCoffee, 4000),
  };
  return settings.champ_name || settings.champ_date || settings.comp_coffee_notes ? settings : null;
}

/** Validate the backup's header and map everything. `now` fills in missing timestamps. */
export function planV1Import(data: unknown, now: number = Date.now()): V1PlanResult {
  if (!isObj(data) || data.app !== 'aeropress-lab') return { ok: false, error: 'not_v1' };
  if (data.v !== 1 && data.v !== '1') return { ok: false, error: 'wrong_version' };

  const ctx: Ctx = { c: new Collector(), now };
  const beans = recordsOf(ctx, 'beans', data.beans).map(({ id, r }) => mapBean(ctx, id, r));
  const recipes = parentsFirst(
    ctx,
    recordsOf(ctx, 'recipes', data.recipes).map(({ id, r }) => mapRecipe(ctx, id, r)),
  );
  const brews = recordsOf(ctx, 'brews', data.brews).map(({ id, r }) => mapBrew(ctx, id, r));
  const duels = recordsOf(ctx, 'duels', data.duels)
    .map(({ id, r }) => mapDuel(ctx, id, r))
    .filter((d): d is ImportDuel => d !== null);

  // References the file can't satisfy. The Worker makes the final call, because a
  // referenced record may already be in the database from an earlier import.
  const beanIds = new Set(beans.map((b) => b.id));
  const recipeIds = new Set(recipes.map((r) => r.id));
  for (const r of recipes) {
    if (r.parent_id && !recipeIds.has(r.parent_id)) ctx.c.warn('recipes', 'parent_not_in_file');
    if (r.bean_id && !beanIds.has(r.bean_id)) ctx.c.warn('recipes', 'bean_not_in_file');
  }
  for (const b of brews) {
    if (b.recipe_id && !recipeIds.has(b.recipe_id)) ctx.c.warn('brews', 'recipe_not_in_file');
    if (b.bean_id && !beanIds.has(b.bean_id)) ctx.c.warn('brews', 'bean_not_in_file');
  }
  for (const d of duels) {
    if (!recipeIds.has(d.recipe_x_id) || !recipeIds.has(d.recipe_y_id)) ctx.c.warn('duels', 'recipe_not_in_file');
    if (d.bean_id && !beanIds.has(d.bean_id)) ctx.c.warn('duels', 'bean_not_in_file');
  }

  return {
    ok: true,
    plan: { beans, recipes, brews, duels, settings: mapSettings(data.meta), ...ctx.c.result() },
  };
}

/** Split a list into request-sized chunks. */
export function chunk<T>(items: readonly T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}
