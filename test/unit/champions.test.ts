import { describe, expect, it } from 'vitest';
import { CHAMPION_RECIPES } from '../../shared/champions';
import { CHAMPION_SUMMARY } from '../../shared/championSummary';
import { planBrew } from '../../shared/phases';
import { recipeInput } from '../../shared/schemas';
import { strings } from '../../web/src/strings';

const c = strings.champions;

describe('champion recipes', () => {
  it('lists each result once, newest first, with sources', () => {
    const ids = CHAMPION_RECIPES.map((e) => e.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const e of CHAMPION_RECIPES) {
      expect(e.id).toBe(`wac-${e.year}-${e.place}`);
      expect(e.year).not.toBe(2020); // no world final that year
      expect(e.sources.length).toBeGreaterThan(0);
      for (const url of e.sources) expect(url).toMatch(/^https:\/\/[^\s]+$/);
    }
    const order = CHAMPION_RECIPES.map((e) => e.year * 10 - e.place);
    expect(order).toEqual([...order].sort((a, b) => b - a));
  });

  it('matches the summary the Recipes tab shows', () => {
    const years = CHAMPION_RECIPES.filter((e) => e.recipe).map((e) => e.year);
    expect(CHAMPION_SUMMARY).toEqual({ recipes: years.length, from: Math.min(...years), to: Math.max(...years) });
  });

  it('has a winner for every year from 2008 on, except 2020', () => {
    const winners = new Set(CHAMPION_RECIPES.filter((e) => e.place === 1).map((e) => e.year));
    const last = Math.max(...winners);
    for (let year = 2008; year <= last; year++) if (year !== 2020) expect(winners.has(year), String(year)).toBe(true);
  });

  it('saves as a valid team recipe, exactly as "Add to our recipes" fills the form', () => {
    for (const e of CHAMPION_RECIPES) {
      if (!e.recipe) continue;
      const input = {
        ...e.recipe,
        name: c.recipeName(e.year, e.place, e.name),
        notes: c.draftNote(e.year, e.place, e.name, e.country, e.sources),
      };
      const parsed = recipeInput.safeParse(input);
      expect(parsed.success, `${e.id}: ${parsed.error?.issues.map((i) => `${i.path.join('.')} ${i.message}`).join('; ')}`).toBe(true);
    }
  });

  it('plans a brew that fits 5:00 whenever the recipe has its press timings', () => {
    for (const e of CHAMPION_RECIPES) {
      if (!e.recipe) continue;
      const plan = planBrew(e.recipe);
      if (plan.missing.length === 0) expect(plan.fits, e.id).toBe(true);
    }
  });
});
