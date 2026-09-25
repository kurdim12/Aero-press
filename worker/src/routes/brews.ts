import { Hono } from 'hono';
import type { AppEnv } from '../env';
import type { BrewRow } from '../../../shared/types';
import { brewInput } from '../../../shared/schemas';
import { extractionYield } from '../../../shared/formulas';
import { requireMember } from '../middleware/auth';
import { ApiError } from '../lib/errors';
import { newId } from '../lib/ids';
import { assertTeamBean, getBrewRow } from '../lib/recipes';
import { readJson } from '../lib/validate';

export const brewRoutes = new Hono<AppEnv>();
brewRoutes.use('*', requireMember);

/** A queued brew may sync hours later; its own timestamp counts if it's plausible. */
const MAX_BREW_AGE_MS = 30 * 24 * 60 * 60 * 1000;
const MAX_CLOCK_SKEW_MS = 5 * 60 * 1000;

/**
 * Log a brew. EY is computed here from the recipe's dose. A phone-made id makes the
 * call idempotent: sending the same brew twice returns the first one.
 */
brewRoutes.post('/', async (c) => {
  const input = await readJson(c, brewInput);
  const me = c.get('member');
  const db = c.env.DB;

  // Logged offline by someone else on this phone: never save it as the person signed in now.
  if (input.member_id !== undefined && input.member_id !== me.id) {
    throw new ApiError(409, 'wrong_member', 'Someone else logged this brew on this phone. It syncs when they sign in there again.');
  }

  if (input.id) {
    const existing = await db
      .prepare('SELECT team_id, member_id FROM brews WHERE id = ?')
      .bind(input.id)
      .first<{ team_id: string; member_id: string }>();
    if (existing) {
      if (existing.team_id === me.team_id && existing.member_id === me.id) {
        return c.json<BrewRow>(await getBrewRow(db, me.team_id, input.id), 200);
      }
      throw new ApiError(409, 'brew_id_taken', 'This brew clashes with another one. Log it again as a new brew.');
    }
  }

  const recipe = await db
    .prepare('SELECT dose_g FROM recipes WHERE id = ? AND team_id = ?')
    .bind(input.recipe_id, me.team_id)
    .first<{ dose_g: number | null }>();
  if (!recipe) {
    throw new ApiError(400, 'recipe_not_found', 'That recipe no longer exists. Pick another recipe.', { field: 'recipe_id' });
  }
  await assertTeamBean(db, me.team_id, input.bean_id);

  const now = Date.now();
  const at = input.brewed_at;
  const createdAt = at && at <= now + MAX_CLOCK_SKEW_MS && at >= now - MAX_BREW_AGE_MS ? at : now;
  const id = input.id ?? newId();

  await db
    .prepare(
      `INSERT OR IGNORE INTO brews (id, team_id, recipe_id, member_id, bean_id, grind_used, total_time_s, tds_pct,
                                    beverage_g, ey_pct, sweetness, acidity, body, clarity, finish, overall, notes, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .bind(
      id,
      me.team_id,
      input.recipe_id,
      me.id,
      input.bean_id ?? null,
      input.grind_used ?? null,
      input.total_time_s ?? null,
      input.tds_pct ?? null,
      input.beverage_g ?? null,
      extractionYield(input.tds_pct, input.beverage_g, recipe.dose_g),
      input.sweetness ?? null,
      input.acidity ?? null,
      input.body ?? null,
      input.clarity ?? null,
      input.finish ?? null,
      input.overall ?? null,
      input.notes ?? null,
      createdAt,
    )
    .run();
  return c.json<BrewRow>(await getBrewRow(db, me.team_id, id), 201);
});
