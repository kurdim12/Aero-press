import { env } from 'cloudflare:workers';
import { beforeEach, describe, expect, it } from 'vitest';
import type { MeResponse, RecipeDetailResponse, RecipeRow, RecipesResponse } from '../../shared/types';
import { TEAM_PIN, addBarista, freshDb, importV1, recipeBody, resultFor, setupTeam, signIn } from './helpers';

beforeEach(freshDb);

const warningCodes = (r: { warnings: { code: string; count: number }[] }) =>
  Object.fromEntries(r.warnings.map((w) => [w.code, w.count]));

describe('v1 import', () => {
  it('imports everything, assigned to the owner, with IDs preserved', async () => {
    const { owner, me } = await setupTeam();
    const results = await importV1(owner);

    expect(resultFor(results, 'beans')).toMatchObject({ inserted: 3, already_there: 0, skipped: 0 });
    expect(resultFor(results, 'recipes')).toMatchObject({ inserted: 7, already_there: 0, skipped: 0 });
    expect(resultFor(results, 'brews')).toMatchObject({ inserted: 13, already_there: 0, skipped: 0 });
    // d-9 duels a recipe that isn't in the backup.
    expect(resultFor(results, 'duels')).toMatchObject({ inserted: 8, already_there: 0, skipped: 1 });
    expect(resultFor(results, 'settings')).toMatchObject({ inserted: 3, already_there: 0 });

    const owners = await env.DB.prepare(
      `SELECT (SELECT COUNT(DISTINCT owner_member_id) FROM recipes) AS recipe_owners,
              (SELECT MIN(owner_member_id) FROM recipes) AS recipe_owner,
              (SELECT MIN(member_id) FROM brews) AS brew_member,
              (SELECT MIN(created_by) FROM duels) AS duel_creator,
              (SELECT MIN(created_by) FROM beans) AS bean_creator`,
    ).first<Record<string, unknown>>();
    expect(owners).toEqual({
      recipe_owners: 1,
      recipe_owner: me.member.id,
      brew_member: me.member.id,
      duel_creator: me.member.id,
      bean_creator: me.member.id,
    });

    // Parent links survive because IDs were preserved.
    const r7 = (await owner.get<RecipeDetailResponse>('/api/recipes/r-7')).body.recipe;
    expect(r7).toMatchObject({ parent_id: 'r-3', bean_id: 'b-pink', press_duration_s: 40, dose_g: 18 });

    // Every foreign key points somewhere real.
    const { results: broken } = await env.DB.prepare('PRAGMA foreign_key_check').all();
    expect(broken).toEqual([]);
  });

  it('is safe to run twice', async () => {
    const { owner } = await setupTeam();
    await importV1(owner);
    const again = await importV1(owner);
    for (const kind of ['beans', 'recipes', 'brews', 'duels'] as const) {
      expect(resultFor(again, kind).inserted).toBe(0);
    }
    expect(resultFor(again, 'recipes').already_there).toBe(7);
    expect(resultFor(again, 'brews').already_there).toBe(13);
    expect(resultFor(again, 'settings')).toMatchObject({ inserted: 0, already_there: 3 });
    const count = await env.DB.prepare('SELECT COUNT(*) AS n FROM recipes').first<{ n: number }>();
    expect(count?.n).toBe(7);
  });

  it('reports what it had to change', async () => {
    const { owner } = await setupTeam();
    const results = await importV1(owner);
    expect(warningCodes(resultFor(results, 'recipes'))).toEqual({ parent_missing: 1 });
    expect(warningCodes(resultFor(results, 'brews'))).toEqual({ recipe_missing: 1 });
    expect(warningCodes(resultFor(results, 'duels'))).toEqual({ recipe_missing: 1 });
    const recipeWarning = resultFor(results, 'recipes').warnings[0];
    expect(recipeWarning?.message).toBe('1 recipe was cloned from a recipe that isn’t in the backup, so it starts a new lineage.');

    const orphan = await env.DB.prepare('SELECT recipe_id, bean_id FROM brews WHERE id = ?').bind('w-13').first();
    expect(orphan).toEqual({ recipe_id: null, bean_id: 'b-kenya' });
  });

  it('computes EY when the backup didn’t record it, and keeps it when it did', async () => {
    const { owner } = await setupTeam();
    await importV1(owner);
    const ey = (id: string) => env.DB.prepare('SELECT ey_pct FROM brews WHERE id = ?').bind(id).first<{ ey_pct: number | null }>();
    expect((await ey('w-06'))?.ey_pct).toBe(17.25); // 1.35 × 230 ÷ 18
    expect((await ey('w-01'))?.ey_pct).toBe(16.21);
    expect((await ey('w-09'))?.ey_pct).toBe(17); // 1.41 × 205 ÷ 17 = 17.003 (dose was "17g")
  });

  it('gives colliding recipe codes the next free number', async () => {
    const { owner } = await setupTeam();
    const mine = (await owner.post<RecipeRow>('/api/recipes', recipeBody({ name: 'Made before import' }))).body;
    expect(mine.code).toBe('R1');
    const results = await importV1(owner);
    const recipes = resultFor(results, 'recipes');
    expect(warningCodes(recipes)).toMatchObject({ code_renamed: 1 });
    expect(recipes.warnings.find((w) => w.code === 'code_renamed')?.message).toContain('R1 → R8');

    const list = (await owner.get<RecipesResponse>('/api/recipes')).body.recipes;
    expect(list.find((r) => r.id === 'r-1')?.code).toBe('R8');
    expect(list.find((r) => r.id === mine.id)?.code).toBe('R1');
    expect(new Set(list.map((r) => r.code)).size).toBe(list.length);
  });

  it('keeps an existing competition coffee and fills only empty settings', async () => {
    const { owner } = await setupTeam();
    await owner.post('/api/beans', { name: 'Already the comp bean', is_competition_coffee: true });
    await env.DB.prepare('UPDATE teams SET champ_name = ?').bind('Set in v2').run();

    const results = await importV1(owner);
    expect(warningCodes(resultFor(results, 'beans'))).toEqual({ extra_competition_coffee: 1 });
    const comp = await env.DB.prepare('SELECT name FROM beans WHERE is_competition_coffee = 1').all<{ name: string }>();
    expect(comp.results.map((b) => b.name)).toEqual(['Already the comp bean']);

    expect(resultFor(results, 'settings')).toMatchObject({ inserted: 2, already_there: 1 });
    const me = (await owner.get<MeResponse>('/api/me')).body;
    expect(me.team).toMatchObject({ champ_name: 'Set in v2', champ_date: '2026-11-14' });
  });

  it('is owner-only and validates every record', async () => {
    const { owner } = await setupTeam();
    const linaId = await addBarista(owner, 'Lina');
    const { client: lina } = await signIn(linaId, TEAM_PIN);
    const denied = await lina.post('/api/import/v1', { kind: 'beans', records: [] });
    expect(denied.status).toBe(403);

    const bad = await owner.post('/api/import/v1', {
      kind: 'brews',
      records: [{ id: 'x', recipe_id: null, bean_id: null, tds_pct: 99 }],
    });
    expect(bad.status).toBe(400);
    expect(bad.body.error.code).toBe('invalid_input');

    const tooMany = await owner.post('/api/import/v1', { kind: 'beans', records: Array.from({ length: 201 }, () => ({})) });
    expect(tooMany.status).toBe(400);
  });
});
