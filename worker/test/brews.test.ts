import { env } from 'cloudflare:workers';
import { beforeEach, describe, expect, it } from 'vitest';
import type { BrewRow, RecipeDetailResponse, RecipeRow } from '../../shared/types';
import { TEAM_PIN, addBarista, freshDb, recipeBody, setupTeam, signIn } from './helpers';

beforeEach(freshDb);

async function teamWithRecipe() {
  const { owner } = await setupTeam();
  const recipe = (await owner.post<RecipeRow>('/api/recipes', recipeBody({ dose_g: 18 }))).body;
  return { owner, recipe };
}

const brew = (recipeId: string, overrides: Record<string, unknown> = {}) => ({
  recipe_id: recipeId,
  total_time_s: 175,
  tds_pct: 1.32,
  beverage_g: 245,
  sweetness: 7.5,
  acidity: 7,
  body: 6.5,
  clarity: 8,
  finish: 7,
  overall: 7.5,
  notes: 'Hot: bright. Cool: sweet.',
  ...overrides,
});

describe('logging a brew', () => {
  it('computes EY from the recipe dose on the server', async () => {
    const { owner, recipe } = await teamWithRecipe();
    const res = await owner.post<BrewRow>('/api/brews', brew(recipe.id, { ey_pct: 99 }));
    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({ recipe_id: recipe.id, total_time_s: 175, ey_pct: 17.97, overall: 7.5, member_initials: 'AK' });

    const noTds = await owner.post<BrewRow>('/api/brews', brew(recipe.id, { tds_pct: null }));
    expect(noTds.body.ey_pct).toBeNull();
  });

  it('shows up in the recipe history and averages', async () => {
    const { owner, recipe } = await teamWithRecipe();
    await owner.post('/api/brews', brew(recipe.id, { overall: 7 }));
    await owner.post('/api/brews', brew(recipe.id, { overall: 8 }));
    const detail = (await owner.get<RecipeDetailResponse>(`/api/recipes/${recipe.id}`)).body;
    expect(detail.brews).toHaveLength(2);
    expect(detail.averages).toMatchObject({ count: 2, overall: 7.5, ey_pct: 17.97 });
    expect(detail.recipe.brew_count).toBe(2);
  });

  it('saves a queued brew once, however many times it is sent', async () => {
    const { owner, recipe } = await teamWithRecipe();
    const id = 'phone-made-brew-id-0001';
    const first = await owner.post<BrewRow>('/api/brews', brew(recipe.id, { id }));
    const again = await owner.post<BrewRow>('/api/brews', brew(recipe.id, { id, overall: 3 }));
    expect(first.status).toBe(201);
    expect(again.status).toBe(200);
    expect(again.body).toMatchObject({ id, overall: 7.5 });
    const count = await env.DB.prepare('SELECT COUNT(*) AS n FROM brews').first<{ n: number }>();
    expect(count?.n).toBe(1);
  });

  it('refuses a brew id that belongs to someone else', async () => {
    const { owner, recipe } = await teamWithRecipe();
    const linaId = await addBarista(owner, 'Lina');
    const { client: lina } = await signIn(linaId, TEAM_PIN);
    const id = 'phone-made-brew-id-0002';
    await owner.post('/api/brews', brew(recipe.id, { id }));
    const clash = await lina.post('/api/brews', brew(recipe.id, { id }));
    expect(clash.status).toBe(409);
    expect(clash.body.error.code).toBe('brew_id_taken');
  });

  it('keeps a plausible brew time from a phone that was offline', async () => {
    const { owner, recipe } = await teamWithRecipe();
    const anHourAgo = Date.now() - 60 * 60 * 1000;
    const late = await owner.post<BrewRow>('/api/brews', brew(recipe.id, { brewed_at: anHourAgo }));
    expect(late.body.created_at).toBe(anHourAgo);

    const future = await owner.post<BrewRow>('/api/brews', brew(recipe.id, { brewed_at: Date.now() + 86_400_000 }));
    expect(Math.abs(future.body.created_at - Date.now())).toBeLessThan(10_000);
  });

  it('lets baristas log brews of any team recipe as themselves', async () => {
    const { owner, recipe } = await teamWithRecipe();
    const linaId = await addBarista(owner, 'Lina Haddad');
    const { client: lina } = await signIn(linaId, TEAM_PIN);
    const res = await lina.post<BrewRow>('/api/brews', brew(recipe.id));
    expect(res.body).toMatchObject({ member_id: linaId, member_initials: 'LH' });
  });

  it('validates scores, times and references', async () => {
    const { owner, recipe } = await teamWithRecipe();
    const half = await owner.post('/api/brews', brew(recipe.id, { overall: 7.25 }));
    expect(half.body.error).toMatchObject({ field: 'overall', message: 'Overall goes in half steps, like 7 or 7.5.' });
    const high = await owner.post('/api/brews', brew(recipe.id, { sweetness: 11 }));
    expect(high.body.error.field).toBe('sweetness');
    const zero = await owner.post('/api/brews', brew(recipe.id, { clarity: 0 }));
    expect(zero.body.error.field).toBe('clarity');
    const time = await owner.post('/api/brews', brew(recipe.id, { total_time_s: 12.5 }));
    expect(time.body.error.field).toBe('total_time_s');
    const missing = await owner.post('/api/brews', brew('not-a-recipe'));
    expect(missing.body.error).toMatchObject({ code: 'recipe_not_found', field: 'recipe_id' });
    const bean = await owner.post('/api/brews', brew(recipe.id, { bean_id: 'not-a-bean' }));
    expect(bean.body.error.code).toBe('bean_not_found');
    const badId = await owner.post('/api/brews', brew(recipe.id, { id: 'short' }));
    expect(badId.body.error.field).toBe('id');
  });
});
