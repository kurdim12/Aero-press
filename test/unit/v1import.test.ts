import { describe, expect, it } from 'vitest';
import fixture from '../fixtures/v1-backup.json';
import { importBean, importBrew, importDuel, importRecipe, importSettings } from '../../shared/schemas';
import { chunk, planV1Import, type V1Plan } from '../../shared/v1import';

const NOW = Date.UTC(2026, 8, 25, 9, 0, 0);

function plan(data: unknown = fixture): V1Plan {
  const result = planV1Import(data, NOW);
  if (!result.ok) throw new Error(`plan failed: ${result.error}`);
  return result.plan;
}

const byId = <T extends { id: string }>(list: T[], id: string): T => {
  const found = list.find((r) => r.id === id);
  if (!found) throw new Error(`no record ${id}`);
  return found;
};

const warning = (p: V1Plan, kind: string, code: string) => p.warnings.find((w) => w.kind === kind && w.code === code)?.count ?? 0;

describe('v1 backup header', () => {
  it('rejects files that are not AeroPress Lab v1 backups', () => {
    expect(planV1Import(null)).toEqual({ ok: false, error: 'not_v1' });
    expect(planV1Import([])).toEqual({ ok: false, error: 'not_v1' });
    expect(planV1Import({ app: 'something-else', v: 1 })).toEqual({ ok: false, error: 'not_v1' });
    expect(planV1Import({ app: 'aeropress-lab', v: 2 })).toEqual({ ok: false, error: 'wrong_version' });
  });

  it('treats missing lists as empty', () => {
    const p = plan({ app: 'aeropress-lab', v: 1 });
    expect([p.beans.length, p.recipes.length, p.brews.length, p.duels.length]).toEqual([0, 0, 0, 0]);
    expect(p.settings).toBeNull();
  });
});

describe('v1 mapping of the sample backup', () => {
  const p = plan();

  it('maps every record', () => {
    expect(p.beans).toHaveLength(3);
    expect(p.recipes).toHaveLength(7);
    expect(p.brews).toHaveLength(13);
    expect(p.duels).toHaveLength(9);
  });

  it('produces records the Worker schemas accept', () => {
    for (const b of p.beans) expect(importBean.safeParse(b).success).toBe(true);
    for (const r of p.recipes) expect(importRecipe.safeParse(r).success).toBe(true);
    for (const b of p.brews) expect(importBrew.safeParse(b).success).toBe(true);
    for (const d of p.duels) expect(importDuel.safeParse(d).success).toBe(true);
    expect(importSettings.safeParse(p.settings).success).toBe(true);
  });

  it('renames bean fields', () => {
    expect(byId(p.beans, 'b-pink')).toEqual({
      id: 'b-pink',
      name: 'Colombia Pink Bourbon',
      roaster: 'Rift Roasters',
      origin: 'Colombia, Huila',
      variety: 'Pink Bourbon',
      process: 'Washed',
      roast_level: 'Light',
      roast_date: '2026-08-25',
      altitude: '1850 m',
      density_notes: 'Medium',
      notes: 'Red fruit, panela',
      is_competition_coffee: true,
      created_at: 1787100000000,
      updated_at: 1787100000000,
    });
    expect(byId(p.beans, 'b-guji').is_competition_coffee).toBe(false);
  });

  it('renames recipe fields and converts m:ss to seconds', () => {
    expect(byId(p.recipes, 'r-1')).toEqual({
      id: 'r-1',
      code: 'R1',
      name: 'Base inverted',
      parent_id: null,
      bean_id: 'b-guji',
      method: 'Inverted',
      filter: 'Paper x2',
      dose_g: 18,
      water_g: 250,
      temp_c: 90,
      grinder: 'Comandante C40',
      grind_setting: '24 clicks',
      water_recipe: 'Third Wave light',
      bloom_water_g: 50,
      bloom_ends_s: 30,
      agitation: '3 stirs',
      press_starts_s: 105,
      press_duration_s: 30,
      bypass_g: 0,
      bypass_temp: null,
      other_steps: 'Swirl before press',
      notes: 'Starting point',
      locked: false,
      created_at: 1787300000000,
      updated_at: 1787300000000,
    });
    expect(byId(p.recipes, 'r-4')).toMatchObject({ parent_id: 'r-1', bypass_g: 40, bypass_temp: 'Room temp' });
  });

  it('reads numbers and times written as text', () => {
    expect(byId(p.recipes, 'r-5')).toMatchObject({
      method: 'Standard',
      dose_g: 17,
      water_g: 220,
      temp_c: 92,
      bloom_water_g: null,
      bloom_ends_s: 45,
      press_starts_s: 120,
      press_duration_s: 30,
    });
    expect(byId(p.brews, 'w-09')).toMatchObject({ tds_pct: 1.41, beverage_g: 205, total_time_s: 185 });
  });

  it('puts parents before children', () => {
    const order = p.recipes.map((r) => r.id);
    const at = (id: string) => order.indexOf(id);
    expect(at('r-1')).toBeLessThan(at('r-2'));
    expect(at('r-2')).toBeLessThan(at('r-3'));
    expect(at('r-3')).toBeLessThan(at('r-7'));
    expect(at('r-1')).toBeLessThan(at('r-4'));
  });

  it('renames brew fields and keeps v1 EY', () => {
    expect(byId(p.brews, 'w-01')).toEqual({
      id: 'w-01',
      recipe_id: 'r-1',
      bean_id: 'b-guji',
      grind_used: '24 clicks',
      total_time_s: 155,
      tds_pct: 1.28,
      beverage_g: 228,
      ey_pct: 16.21,
      sweetness: 6,
      acidity: 7,
      body: 6,
      clarity: 6.5,
      finish: 6,
      overall: 6.5,
      notes: 'Hot: bright. Cool: thin.',
      created_at: 1787310000000,
    });
    // Missing EY stays empty here; the Worker computes it from the recipe's dose.
    expect(byId(p.brews, 'w-06').ey_pct).toBeNull();
    // A score of 0 meant "not rated".
    expect(byId(p.brews, 'w-13').overall).toBeNull();
  });

  it('maps duels, with an empty winner as a draw', () => {
    expect(byId(p.duels, 'd-1')).toEqual({
      id: 'd-1',
      recipe_x_id: 'r-1',
      recipe_y_id: 'r-2',
      bean_id: 'b-guji',
      winner_recipe_id: 'r-2',
      x_votes: 1,
      y_votes: 2,
      judge_count: 3,
      notes: null,
      created_at: 1787620000000,
      revealed_at: 1787620000000,
    });
    expect(byId(p.duels, 'd-4')).toMatchObject({ winner_recipe_id: null, notes: "Couldn't separate" });
  });

  it('reads the settings doc from meta', () => {
    expect(p.settings).toEqual({
      champ_name: 'Jordan AeroPress Championship 2026',
      champ_date: '2026-11-14',
      comp_coffee_notes: 'Organizer usually supplies a washed Ethiopian, light roast.',
    });
  });

  it('reports references the file cannot satisfy and fields it does not use', () => {
    expect(warning(p, 'recipes', 'parent_not_in_file')).toBe(1);
    expect(warning(p, 'brews', 'recipe_not_in_file')).toBe(1);
    expect(warning(p, 'duels', 'recipe_not_in_file')).toBe(1);
    expect(p.ignoredFields).toEqual(
      expect.arrayContaining([
        { kind: 'recipes', field: 'color', count: 1 },
        { kind: 'brews', field: 'sweetnessCool', count: 1 },
      ]),
    );
    // Derived values the app recalculates are not reported.
    expect(p.ignoredFields.find((f) => f.field === 'ratio')).toBeUndefined();
  });
});

describe('v1 mapping edge cases', () => {
  const wrap = (parts: Record<string, unknown>) => ({ app: 'aeropress-lab', v: 1, ...parts });

  it('gives records without an id the same id every time', () => {
    const data = wrap({ beans: [{ name: 'No id bean' }] });
    const first = plan(data).beans[0]?.id;
    expect(first).toMatch(/^v1-beans-/);
    expect(plan(data).beans[0]?.id).toBe(first);
    expect(warning(plan(data), 'beans', 'missing_id')).toBe(1);
  });

  it('skips duplicate ids after the first', () => {
    const p = plan(wrap({ beans: [{ id: 'x', name: 'First' }, { id: 'x', name: 'Second' }] }));
    expect(p.beans).toHaveLength(1);
    expect(p.beans[0]?.name).toBe('First');
    expect(warning(p, 'beans', 'duplicate_id')).toBe(1);
  });

  it('breaks a loop in the lineage', () => {
    const p = plan(
      wrap({
        recipes: [
          { id: 'A', code: 'R1', parentId: 'B', method: 'Inverted' },
          { id: 'B', code: 'R2', parentId: 'A', method: 'Inverted' },
        ],
      }),
    );
    expect(p.recipes.filter((r) => r.parent_id === null)).toHaveLength(1);
    expect(warning(p, 'recipes', 'lineage_loop')).toBe(1);
  });

  it('empties unreadable values and counts them', () => {
    const p = plan(
      wrap({
        beans: [{ id: 'b', name: 'Bean', roastDate: '31/12/2026' }],
        recipes: [{ id: 'r', method: 'aero-magic', dose: 'lots', steepTime: 'soon' }],
        brews: [{ id: 'w', recipeId: 'r', time: 'abc', overall: 12, tds: 45 }],
      }),
    );
    expect(p.beans[0]?.roast_date).toBeNull();
    expect(p.recipes[0]).toMatchObject({ method: 'Inverted', dose_g: null, press_starts_s: null });
    expect(p.brews[0]).toMatchObject({ total_time_s: null, overall: null, tds_pct: null });
    expect(warning(p, 'beans', 'bad_date')).toBe(1);
    expect(warning(p, 'recipes', 'method_defaulted')).toBe(1);
    expect(warning(p, 'recipes', 'bad_number')).toBe(1);
    expect(warning(p, 'recipes', 'bad_time')).toBe(1);
    expect(warning(p, 'brews', 'bad_time')).toBe(1);
    expect(warning(p, 'brews', 'score_out_of_range')).toBe(1);
    expect(warning(p, 'brews', 'bad_number')).toBe(1);
  });

  it('drops duels it cannot score', () => {
    const p = plan(
      wrap({
        duels: [
          { id: 'd1', x: 'A', y: 'B', winner: 'C' },
          { id: 'd2', x: 'A', y: 'A', winner: 'A' },
          { id: 'd3', x: 'A', winner: 'A' },
          { id: 'd4', x: 'A', y: 'B', winner: 'y', xVotes: 'n/a' },
        ],
      }),
    );
    expect(p.duels.map((d) => d.id)).toEqual(['d4']);
    expect(p.duels[0]).toMatchObject({ winner_recipe_id: 'B', x_votes: 0, judge_count: 0 });
    expect(warning(p, 'duels', 'duel_bad_winner')).toBe(1);
    expect(warning(p, 'duels', 'duel_missing_recipe')).toBe(2);
  });

  it('reads timestamps in seconds, milliseconds or ISO form', () => {
    const p = plan(
      wrap({
        beans: [
          { id: 's', name: 'Seconds', t: 1787000000 },
          { id: 'm', name: 'Millis', t: 1787000000000 },
          { id: 'i', name: 'ISO', t: '2026-08-17T20:53:20.000Z' },
          { id: 'n', name: 'None' },
        ],
      }),
    );
    expect(p.beans.map((b) => b.created_at)).toEqual([1787000000000, 1787000000000, 1787000000000, NOW]);
  });

  it('normalises recipe codes', () => {
    const p = plan(
      wrap({
        recipes: [
          { id: 'a', code: 'AK-R12', method: 'Inverted' },
          { id: 'b', code: 'r3', method: 'Inverted' },
          { id: 'c', code: '', method: 'Inverted' },
        ],
      }),
    );
    expect(p.recipes.map((r) => r.code)).toEqual(['R12', 'R3', null]);
  });
});

describe('chunk', () => {
  it('splits into request-sized pieces', () => {
    expect(chunk([1, 2, 3, 4, 5], 2)).toEqual([[1, 2], [3, 4], [5]]);
    expect(chunk([], 200)).toEqual([]);
  });
});
