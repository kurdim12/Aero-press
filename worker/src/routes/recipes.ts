import { Hono } from 'hono';
import type { AppEnv } from '../env';
import type { RecipeDetailResponse, RecipeRow, RecipesResponse } from '../../../shared/types';
import { recipeInput, recipeListQuery, recipeLockInput, recipeUpdate } from '../../../shared/schemas';
import { requireMember, requireOwner } from '../middleware/auth';
import { ApiError, notFound } from '../lib/errors';
import { newId } from '../lib/ids';
import { isUniqueViolation } from '../lib/members';
import {
  RECIPE_FIELD_COLUMNS,
  assertTeamBean,
  getRecipeRow,
  listRecipes,
  maxCodeNumber,
  memberCodes,
  recipeBrewAverages,
  listRecipeBrews,
} from '../lib/recipes';
import { idParam, readJson, readQuery } from '../lib/validate';

export const recipeRoutes = new Hono<AppEnv>();
recipeRoutes.use('*', requireMember);

/** Sorted by Elo. ?scope=mine for your own; ?bean=<id> rates on that bean's duels only. */
recipeRoutes.get('/', async (c) => {
  const { scope, bean } = readQuery(c, recipeListQuery);
  const me = c.get('member');
  const db = c.env.DB;
  let beanFilter: RecipesResponse['bean_filter'] = null;
  if (bean) {
    beanFilter = await db
      .prepare('SELECT id, name FROM beans WHERE id = ? AND team_id = ?')
      .bind(bean, me.team_id)
      .first<{ id: string; name: string }>();
    if (!beanFilter) throw notFound('bean');
  }
  const recipes = await listRecipes(db, me.team_id, {
    ownerId: scope === 'mine' ? me.id : undefined,
    beanId: bean,
  });
  return c.json<RecipesResponse>({ recipes, bean_filter: beanFilter });
});

recipeRoutes.get('/:id', async (c) => {
  const id = idParam(c, 'recipe');
  const me = c.get('member');
  const db = c.env.DB;
  const recipe = await getRecipeRow(db, me.team_id, id);
  const [brews, averages] = await Promise.all([
    listRecipeBrews(db, me.team_id, id),
    recipeBrewAverages(db, me.team_id, id),
  ]);
  return c.json<RecipeDetailResponse>({ recipe, brews, averages });
});

const fieldValues = (input: Record<string, unknown>) => RECIPE_FIELD_COLUMNS.map((col) => input[col] ?? null);

/** New recipe, or clone-and-tweak when parent_id is set. The code is the member's next R-number. */
recipeRoutes.post('/', async (c) => {
  const input = await readJson(c, recipeInput);
  const me = c.get('member');
  const db = c.env.DB;

  if (input.parent_id) {
    const parent = await db
      .prepare('SELECT 1 AS ok FROM recipes WHERE id = ? AND team_id = ?')
      .bind(input.parent_id, me.team_id)
      .first();
    if (!parent) {
      throw new ApiError(400, 'parent_not_found', 'The recipe you cloned no longer exists. Go back to the recipe list.');
    }
  }
  await assertTeamBean(db, me.team_id, input.bean_id);

  const id = newId();
  const now = Date.now();
  const columns = ['id', 'team_id', 'owner_member_id', 'code', 'parent_id', ...RECIPE_FIELD_COLUMNS, 'locked', 'created_at', 'updated_at'];
  const insert = (code: string) =>
    db
      .prepare(`INSERT INTO recipes (${columns.join(', ')}) VALUES (${columns.map(() => '?').join(', ')})`)
      .bind(id, me.team_id, me.id, code, input.parent_id ?? null, ...fieldValues(input), 0, now, now)
      .run();

  // Two phones saving at the same moment can race for the same code; take the next one.
  for (let attempt = 1; ; attempt++) {
    const code = `R${maxCodeNumber(await memberCodes(db, me.id)) + 1}`;
    try {
      await insert(code);
      break;
    } catch (err) {
      if (!isUniqueViolation(err) || attempt >= 3) throw err;
    }
  }
  return c.json<RecipeRow>(await getRecipeRow(db, me.team_id, id), 201);
});

/** Edit every field. Only the recipe's author or the owner, and never the locked recipe. */
recipeRoutes.put('/:id', async (c) => {
  const input = await readJson(c, recipeUpdate);
  const me = c.get('member');
  const db = c.env.DB;
  const current = await getRecipeRow(db, me.team_id, idParam(c, 'recipe'));
  if (me.role !== 'owner' && current.owner_member_id !== me.id) {
    throw new ApiError(
      403,
      'not_your_recipe',
      `${current.display_code} belongs to ${current.owner_name}. Clone it to make your own version.`,
    );
  }
  if (current.locked) {
    throw new ApiError(409, 'recipe_locked', 'This is the locked competition recipe. The owner has to unlock it before it can change.');
  }
  await assertTeamBean(db, me.team_id, input.bean_id);

  await db
    .prepare(
      `UPDATE recipes SET ${RECIPE_FIELD_COLUMNS.map((col) => `${col} = ?`).join(', ')}, updated_at = ?
        WHERE id = ? AND team_id = ?`,
    )
    .bind(...fieldValues(input), Date.now(), current.id, me.team_id)
    .run();
  return c.json<RecipeRow>(await getRecipeRow(db, me.team_id, current.id));
});

/** Owner marks the competition recipe. Locking one unlocks any other. */
recipeRoutes.put('/:id/lock', requireOwner, async (c) => {
  const { locked } = await readJson(c, recipeLockInput);
  const me = c.get('member');
  const db = c.env.DB;
  const current = await getRecipeRow(db, me.team_id, idParam(c, 'recipe'));
  await db.batch(
    locked
      ? [
          db.prepare('UPDATE recipes SET locked = 0 WHERE team_id = ? AND locked = 1 AND id != ?').bind(me.team_id, current.id),
          db.prepare('UPDATE recipes SET locked = 1 WHERE id = ? AND team_id = ?').bind(current.id, me.team_id),
        ]
      : [db.prepare('UPDATE recipes SET locked = 0 WHERE id = ? AND team_id = ?').bind(current.id, me.team_id)],
  );
  return c.json<RecipeRow>(await getRecipeRow(db, me.team_id, current.id));
});
