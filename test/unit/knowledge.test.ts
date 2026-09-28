import { describe, expect, it } from 'vitest';
import { CHAMPION_RECIPES } from '../../shared/champions';
import { KNOWLEDGE, KNOWLEDGE_IDS, podiumBody } from '../../shared/knowledge';
import { MODELS } from '../../worker/src/ai/config';
import { KIND_SECTIONS, askSections, referenceBlock, withReference } from '../../worker/src/ai/knowledge';

describe('the coach’s reference', () => {
  it('has every section once, in order, complete', () => {
    expect(KNOWLEDGE.map((s) => s.id)).toEqual([...KNOWLEDGE_IDS]);
    for (const s of KNOWLEDGE) {
      expect(s.title.length, s.id).toBeGreaterThan(3);
      expect(s.summary.length, s.id).toBeGreaterThan(20);
      expect(s.body.length, s.id).toBeGreaterThan(400);
      expect(s.keywords.length, s.id).toBeGreaterThan(3);
      for (const k of s.keywords) expect(k, s.id).toBe(k.toLowerCase());
      for (const source of s.sources) expect(source.url, s.id).toMatch(/^https:\/\//);
    }
  });

  it('stays small enough to send with every call', () => {
    // Each section under ~1k tokens, the whole reference under ~9k.
    for (const s of KNOWLEDGE) expect(s.body.length, s.id).toBeLessThan(4000);
    expect(KNOWLEDGE.reduce((sum, s) => sum + s.body.length, 0)).toBeLessThan(36_000);
    // What one call gets: under ~5k tokens of reference.
    for (const [kind, ids] of Object.entries(KIND_SECTIONS)) expect(referenceBlock(ids).length, kind).toBeLessThan(20_000);
  });

  it('computes the podium facts from the champion library', () => {
    // Read with plain spaces (the text keeps numbers and units together with no-break spaces).
    const body = podiumBody(CHAMPION_RECIPES).replace(/\u00a0/g, ' ');
    const published = CHAMPION_RECIPES.filter((c) => c.recipe).length;
    expect(body).toContain(`${published} published podium recipes`);
    expect(body).toContain('Every podium recipe since 2021 uses 18 g');
    expect(body).toContain('2025 84 °C, 2024 96 °C, 2023 89 °C, 2022 92 °C, 2021 80 °C');
    expect(body).toContain('2025 Némo Pop (Australia): Standard');
    // A new recipe off the cap changes the sentence rather than leaving it wrong.
    const offCap = CHAMPION_RECIPES.map((c) => (c.id === 'wac-2025-1' ? { ...c, recipe: { ...c.recipe!, dose_g: 15 } } : c));
    expect(podiumBody(offCap).replace(/\u00a0/g, ' ')).toContain('Since 2021 (the WAC’s dose cap): 15–18 g');
  });
});

describe('what each coach call is taught', () => {
  it('gives every job its sections, and quick log none', () => {
    expect(Object.keys(KIND_SECTIONS).sort()).toEqual(Object.keys(MODELS).sort());
    expect(KIND_SECTIONS.quickLog).toEqual([]);
    for (const ids of Object.values(KIND_SECTIONS)) for (const id of ids) expect(KNOWLEDGE_IDS).toContain(id);
    expect(KIND_SECTIONS.beanTips).toEqual(expect.arrayContaining(['beans', 'process', 'roast', 'temperature']));
  });

  it('picks sections for a question from its words, in English or Arabic', () => {
    const base = ['method', 'extraction', 'troubleshooting'];
    expect(askSections('Which water minerals should we use, Third Wave or Aquacode?')).toEqual([...base, 'water']);
    expect(askSections('How long should the beans rest, and can we freeze them?')).toEqual(expect.arrayContaining(['roast', 'beans']));
    expect(askSections('ما هي درجة حرارة الماء المناسبة للتحميص الفاتح؟')).toEqual(expect.arrayContaining(['temperature', 'roast']));
    // "sourcing" is about buying coffee, "interest" isn't about resting it.
    expect(askSections('Any interest in sourcing a Kenyan lot?')).toEqual([...base, 'beans', 'sourcing']);
    // A question that names nothing gets the brewing basics.
    expect(askSections('What should I try next?')).toEqual([...base, 'temperature', 'grind', 'aeropress']);
    // About a bean: what a coffee needs.
    expect(askSections('What do you think?', 'bean')).toEqual([...base, 'beans', 'process', 'roast', 'temperature', 'grind']);
    // Never more than 8, however much a question names.
    const everything = KNOWLEDGE.map((s) => s.keywords[0]).join(' ');
    expect(askSections(everything)).toHaveLength(8);
  });

  it('adds the reference, then the house rules, to the call’s own prompt', () => {
    expect(withReference('You are a coach.', [], null)).toBe('You are a coach.');
    const full = withReference('You are a coach.', ['temperature'], 'Our kettle tops out at 96 °C.');
    expect(full.startsWith('You are a coach.')).toBe(true);
    expect(full).toContain('## Water temperature');
    expect(full).toContain('Amman');
    expect(full.indexOf('<reference>')).toBeLessThan(full.indexOf('<house_rules>'));
    expect(full.trimEnd().endsWith('Our kettle tops out at 96 °C.\n</house_rules>')).toBe(true);
  });
});
