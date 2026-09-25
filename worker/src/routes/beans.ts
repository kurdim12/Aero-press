import { Hono } from 'hono';
import type { AppEnv } from '../env';
import type { BeanRow, BeansResponse } from '../../../shared/types';
import { beanInput } from '../../../shared/schemas';
import { requireMember } from '../middleware/auth';
import { ApiError, notFound } from '../lib/errors';
import { newId } from '../lib/ids';
import { idParam, readJson } from '../lib/validate';

// Beans are shared by the whole team. Anyone can add or edit one; only the owner
// chooses the competition coffee, and there is at most one.
export const beanRoutes = new Hono<AppEnv>();
beanRoutes.use('*', requireMember);

type BeanDbRow = Omit<BeanRow, 'is_competition_coffee'> & { is_competition_coffee: number; team_id: string };

const BEAN_SELECT = `
  SELECT b.*,
         (SELECT COUNT(*) FROM brews w WHERE w.bean_id = b.id) AS brew_count,
         (SELECT COUNT(*) FROM recipes r WHERE r.bean_id = b.id) AS recipe_count
    FROM beans b`;

function toBeanRow({ team_id: _team, is_competition_coffee, ...rest }: BeanDbRow): BeanRow {
  return { ...rest, is_competition_coffee: is_competition_coffee === 1 };
}

async function getBean(db: D1Database, teamId: string, id: string): Promise<BeanRow> {
  const row = await db.prepare(`${BEAN_SELECT} WHERE b.id = ? AND b.team_id = ?`).bind(id, teamId).first<BeanDbRow>();
  if (!row) throw notFound('bean');
  return toBeanRow(row);
}

const compOwnerOnly = () =>
  new ApiError(403, 'owner_only', 'Only the owner can choose the competition coffee.', { field: 'is_competition_coffee' });

/** Competition coffee first, then newest. */
beanRoutes.get('/', async (c) => {
  const me = c.get('member');
  const { results } = await c.env.DB.prepare(
    `${BEAN_SELECT} WHERE b.team_id = ? ORDER BY b.is_competition_coffee DESC, b.created_at DESC`,
  )
    .bind(me.team_id)
    .all<BeanDbRow>();
  return c.json<BeansResponse>({ beans: results.map(toBeanRow) });
});

beanRoutes.get('/:id', async (c) => {
  const me = c.get('member');
  return c.json<BeanRow>(await getBean(c.env.DB, me.team_id, idParam(c, 'bean')));
});

beanRoutes.post('/', async (c) => {
  const input = await readJson(c, beanInput);
  const me = c.get('member');
  const makeComp = input.is_competition_coffee === true;
  if (makeComp && me.role !== 'owner') throw compOwnerOnly();

  const db = c.env.DB;
  const id = newId();
  const now = Date.now();
  await db.batch([
    ...(makeComp ? [db.prepare('UPDATE beans SET is_competition_coffee = 0 WHERE team_id = ?').bind(me.team_id)] : []),
    db
      .prepare(
        `INSERT INTO beans (id, team_id, name, roaster, origin, variety, process, roast_level, roast_date,
                            altitude, density_notes, notes, is_competition_coffee, created_by, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .bind(
        id,
        me.team_id,
        input.name,
        input.roaster ?? null,
        input.origin ?? null,
        input.variety ?? null,
        input.process ?? null,
        input.roast_level ?? null,
        input.roast_date ?? null,
        input.altitude ?? null,
        input.density_notes ?? null,
        input.notes ?? null,
        makeComp ? 1 : 0,
        me.id,
        now,
        now,
      ),
  ]);
  return c.json<BeanRow>(await getBean(db, me.team_id, id), 201);
});

/** Full edit. Leaving out is_competition_coffee keeps the current marker. */
beanRoutes.put('/:id', async (c) => {
  const input = await readJson(c, beanInput);
  const me = c.get('member');
  const db = c.env.DB;
  const current = await getBean(db, me.team_id, idParam(c, 'bean'));
  const comp = input.is_competition_coffee ?? current.is_competition_coffee;
  if (comp !== current.is_competition_coffee && me.role !== 'owner') throw compOwnerOnly();

  await db.batch([
    ...(comp && !current.is_competition_coffee
      ? [db.prepare('UPDATE beans SET is_competition_coffee = 0 WHERE team_id = ?').bind(me.team_id)]
      : []),
    db
      .prepare(
        `UPDATE beans SET name = ?, roaster = ?, origin = ?, variety = ?, process = ?, roast_level = ?,
                          roast_date = ?, altitude = ?, density_notes = ?, notes = ?,
                          is_competition_coffee = ?, updated_at = ?
          WHERE id = ? AND team_id = ?`,
      )
      .bind(
        input.name,
        input.roaster ?? null,
        input.origin ?? null,
        input.variety ?? null,
        input.process ?? null,
        input.roast_level ?? null,
        input.roast_date ?? null,
        input.altitude ?? null,
        input.density_notes ?? null,
        input.notes ?? null,
        comp ? 1 : 0,
        Date.now(),
        current.id,
        me.team_id,
      ),
  ]);
  return c.json<BeanRow>(await getBean(db, me.team_id, current.id));
});
