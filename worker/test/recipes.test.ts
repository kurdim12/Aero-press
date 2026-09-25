import { beforeEach, describe, expect, it } from 'vitest';
import type { BeanRow, RecipeDetailResponse, RecipeRow, RecipesResponse } from '../../shared/types';
import { TEAM_PIN, addBarista, freshDb, importV1, recipeBody, setupTeam, signIn } from './helpers';

beforeEach(freshDb);

async function teamWithBarista() {
  const { owner, me } = await setupTeam();
  const linaId = await addBarista(owner, 'Lina Haddad');
  const { client: lina } = await signIn(linaId, TEAM_PIN);
  return { owner, lina, ownerId: me.member.id };
}

describe('creating recipes', () => {
  it('numbers codes per member and shows them with initials', async () => {
    const { owner, lina } = await teamWithBarista();
    const a = await owner.post<RecipeRow>('/api/recipes', recipeBody());
    const b = await owner.post<RecipeRow>('/api/recipes', recipeBody());
    const c = await lina.post<RecipeRow>('/api/recipes', recipeBody());
    expect(a.status).toBe(201);
    expect([a.body.code, b.body.code, c.body.code]).toEqual(['R1', 'R2', 'R1']);
    expect([a.body.display_code, c.body.display_code]).toEqual(['AK-R1', 'LH-R1']);
    expect(a.body).toMatchObject({ elo: 1500, wins: 0, losses: 0, draws: 0, duels: 0, brew_count: 0, locked: false });
  });

  it('clones with a link to the parent', async () => {
    const { owner, lina } = await teamWithBarista();
    const parent = (await owner.post<RecipeRow>('/api/recipes', recipeBody())).body;
    const clone = await lina.post<RecipeRow>('/api/recipes', recipeBody({ parent_id: parent.id, temp_c: 88 }));
    expect(clone.body).toMatchObject({ parent_id: parent.id, parent_display_code: 'AK-R1', display_code: 'LH-R1', temp_c: 88 });
    expect((await lina.post('/api/recipes', recipeBody({ parent_id: 'missing' }))).body.error.code).toBe('parent_not_found');
  });

  it('validates fields', async () => {
    const { owner } = await setupTeam();
    const early = await owner.post('/api/recipes', recipeBody({ bloom_ends_s: 60, press_starts_s: 45 }));
    expect(early.body.error).toMatchObject({ field: 'press_starts_s', message: 'The press can’t start before the bloom ends.' });
    const hot = await owner.post('/api/recipes', recipeBody({ temp_c: 120 }));
    expect(hot.body.error).toMatchObject({ field: 'temp_c', message: 'Temperature must be 100 or less.' });
    const method = await owner.post('/api/recipes', recipeBody({ method: 'Upside down' }));
    expect(method.body.error.field).toBe('method');
    const bean = await owner.post('/api/recipes', recipeBody({ bean_id: 'not-ours' }));
    expect(bean.body.error).toMatchObject({ code: 'bean_not_found', field: 'bean_id' });
  });
});

describe('editing and locking', () => {
  it('only the author or the owner edits a recipe', async () => {
    const { owner, lina } = await teamWithBarista();
    const ownerRecipe = (await owner.post<RecipeRow>('/api/recipes', recipeBody())).body;
    const linaRecipe = (await lina.post<RecipeRow>('/api/recipes', recipeBody())).body;

    const denied = await lina.put(`/api/recipes/${ownerRecipe.id}`, recipeBody({ temp_c: 85 }));
    expect(denied.status).toBe(403);
    expect(denied.body.error.code).toBe('not_your_recipe');

    expect((await lina.put<RecipeRow>(`/api/recipes/${linaRecipe.id}`, recipeBody({ temp_c: 86 }))).body.temp_c).toBe(86);
    expect((await owner.put<RecipeRow>(`/api/recipes/${linaRecipe.id}`, recipeBody({ temp_c: 87 }))).body.temp_c).toBe(87);
  });

  it('the owner locks one competition recipe, which then can’t change', async () => {
    const { owner, lina } = await teamWithBarista();
    const first = (await owner.post<RecipeRow>('/api/recipes', recipeBody())).body;
    const second = (await lina.post<RecipeRow>('/api/recipes', recipeBody())).body;

    expect((await lina.put(`/api/recipes/${first.id}/lock`, { locked: true })).status).toBe(403);
    expect((await owner.put<RecipeRow>(`/api/recipes/${first.id}/lock`, { locked: true })).body.locked).toBe(true);

    const blocked = await owner.put(`/api/recipes/${first.id}`, recipeBody({ temp_c: 80 }));
    expect(blocked.status).toBe(409);
    expect(blocked.body.error.code).toBe('recipe_locked');

    await owner.put(`/api/recipes/${second.id}/lock`, { locked: true });
    const list = (await owner.get<RecipesResponse>('/api/recipes')).body.recipes;
    expect(list.filter((r) => r.locked).map((r) => r.id)).toEqual([second.id]);

    await owner.put(`/api/recipes/${second.id}/lock`, { locked: false });
    expect((await owner.get<RecipesResponse>('/api/recipes')).body.recipes.some((r) => r.locked)).toBe(false);
  });
});

describe('ranking and detail after importing v1 data', () => {
  it('sorts by Elo computed from revealed duels, with W-L-D records', async () => {
    const { owner } = await setupTeam();
    await importV1(owner);
    const list = (await owner.get<RecipesResponse>('/api/recipes')).body.recipes;
    expect(list.map((r) => r.code)).toEqual(['R7', 'R3', 'R5', 'R4', 'R6', 'R2', 'R1']);
    const byCode = (code: string) => list.find((r) => r.code === code);
    expect(byCode('R7')).toMatchObject({ elo: 1515, wins: 2, losses: 1, draws: 0, duels: 3, brew_count: 3 });
    expect(byCode('R3')).toMatchObject({ elo: 1514, wins: 3, losses: 2, draws: 0 });
    expect(byCode('R2')).toMatchObject({ wins: 1, losses: 1, draws: 1 });
    expect(byCode('R6')).toMatchObject({ elo: 1500, duels: 0, parent_id: null });
    expect(byCode('R7')?.parent_display_code).toBe('AK-R3');
  });

  it('rates on one bean’s duels when filtered by bean', async () => {
    const { owner } = await setupTeam();
    await importV1(owner);
    const res = await owner.get<RecipesResponse>('/api/recipes?bean=b-pink');
    expect(res.body.bean_filter).toEqual({ id: 'b-pink', name: 'Colombia Pink Bourbon' });
    expect(res.body.recipes.map((r) => [r.code, r.elo, r.wins, r.losses])).toEqual([
      ['R7', 1531, 2, 0],
      ['R5', 1501, 1, 1],
      ['R3', 1468, 0, 2],
    ]);
    expect((await owner.get('/api/recipes?bean=nope')).status).toBe(404);
  });

  it('filters to my recipes', async () => {
    const { owner, lina } = await teamWithBarista();
    await importV1(owner);
    await lina.post('/api/recipes', recipeBody());
    const mine = (await lina.get<RecipesResponse>('/api/recipes?scope=mine')).body.recipes;
    expect(mine.map((r) => r.display_code)).toEqual(['LH-R1']);
    expect((await lina.get<RecipesResponse>('/api/recipes')).body.recipes).toHaveLength(8);
    expect((await lina.get('/api/recipes?scope=theirs')).status).toBe(400);
  });

  it('shows brew averages and history on the detail', async () => {
    const { owner } = await setupTeam();
    await importV1(owner);
    const detail = (await owner.get<RecipeDetailResponse>('/api/recipes/r-3')).body;
    expect(detail.recipe.display_code).toBe('AK-R3');
    expect(detail.averages).toMatchObject({ count: 3, overall: 7.67, sweetness: 7.67, tds_pct: 1.36 });
    expect(detail.averages.ey_pct).toBeCloseTo((17.33 + 17.25 + 17.23) / 3, 2);
    expect(detail.brews.map((b) => b.id)).toEqual(['w-07', 'w-06', 'w-05']);
    expect(detail.brews[0]).toMatchObject({ member_initials: 'AK', bean_name: 'Ethiopia Guji Hambela', total_time_s: 165 });
    expect((await owner.get('/api/recipes/nope')).status).toBe(404);
  });

  it('includes a bean’s brew and recipe counts', async () => {
    const { owner } = await setupTeam();
    await importV1(owner);
    const beans = (await owner.get<{ beans: BeanRow[] }>('/api/beans')).body.beans;
    expect(beans.map((b) => [b.name, b.brew_count, b.recipe_count, b.is_competition_coffee])).toEqual([
      ['Colombia Pink Bourbon', 4, 2, true],
      ['Kenya Nyeri AA', 1, 1, false], // w-13 keeps its bean though its recipe is missing
      ['Ethiopia Guji Hambela', 8, 4, false],
    ]);
  });
});
