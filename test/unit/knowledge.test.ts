import { describe, expect, it } from 'vitest';
import { CHAMPION_RECIPES } from '../../shared/champions';
import { KNOWLEDGE, KNOWLEDGE_IDS, type KnowledgeId, championCoffee, podiumBody } from '../../shared/knowledge';
import { MODELS } from '../../worker/src/ai/config';
import { KIND_SECTIONS, askSections, fold, referenceBlock, withReference } from '../../worker/src/ai/knowledge';
import { clipToSentence } from '../../worker/src/lib/text';

/** The reference keeps numbers and units together with no-break spaces; read it with plain ones. */
const plain = (text: string) => text.replace(/ /g, ' ');
const body = (id: KnowledgeId) => plain(KNOWLEDGE.find((s) => s.id === id)!.body);
const published = CHAMPION_RECIPES.filter((c) => c.recipe !== null);
const winner = (year: number) => published.find((c) => c.year === year && c.place === 1)!;

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
    // Written sections under ~1k tokens each; the podium section (computed) under ~2k.
    for (const s of KNOWLEDGE) expect(s.body.length, s.id).toBeLessThan(s.id === 'podium' ? 8000 : 4500);
    // What one call gets: under ~6k tokens of reference, a question's 8 largest included.
    for (const [kind, ids] of Object.entries(KIND_SECTIONS)) expect(referenceBlock(ids).length, kind).toBeLessThan(24_000);
    const largest = [...KNOWLEDGE].sort((a, b) => b.body.length - a.body.length).slice(0, 8);
    expect(referenceBlock(largest.map((s) => s.id)).length).toBeLessThan(28_000);
  });

  it('computes the podium facts from the champion library', () => {
    const text = plain(podiumBody(CHAMPION_RECIPES));
    expect(text).toContain(`${published.length} published podium recipes`);
    expect(text).toContain('Every podium recipe since 2021 uses 18 g');
    expect(text).toContain('2025 84 °C, 2024 96 °C, 2023 89 °C, 2022 92 °C, 2021 80 °C');
    // Counted by hand from shared/champions.ts: 11 set bypass amounts (2025, 2024 #2, 2022 #2,
    // 2021 #2 and #3, 2019 #1 and #2, 2018 #1 and #2, 2017 #2 and #3), 4 top-ups to a weight
    // (2024, 2023, 2022 and 2017 winners), 5 undiluted; 21 rinsed or wetted filters (2022 #3's is
    // "dry (not rinsed)"), 7 with two filters stacked.
    expect(text).toContain('Dilution: 15 recipes dilute the concentrate with water: 11 add a set amount');
    expect(text).toContain('and 4 top up to a target drink weight. 5 serve it undiluted');
    expect(text).toContain('21 say the filter is rinsed or wetted; 7 stack two filters; 2 add a metal filter');
    // Recent winners come with their coffee and the method that has their dilution.
    expect(text).toContain('2024 George Stanica (Romania), 96 °C. Coffee: washed Ethiopia Guji');
    expect(text).toContain('Add warm water from the kettle up to 130-135 g');
    expect(text).toContain('2022 Jibbi Little (Australia), 92 °C. Coffee: Colombia Finca Juan Martin, natural Striped Red Bourbon');
    // A new recipe off the cap changes the sentence rather than leaving it wrong.
    const offCap = CHAMPION_RECIPES.map((c) => (c.id === 'wac-2025-1' ? { ...c, recipe: { ...c.recipe!, dose_g: 15 } } : c));
    expect(plain(podiumBody(offCap))).toContain('Since 2021 (the WAC’s dose cap): 15–18 g');
  });

  it('matches the champion library wherever a section quotes it', () => {
    const temps = published.map((c) => c.recipe!.temp_c).filter((t): t is number => t !== null);
    expect([Math.min(...temps), Math.max(...temps)]).toEqual([75, 96]);
    const sorted = [...temps].sort((a, b) => a - b);
    expect(sorted[Math.floor(sorted.length / 2)]).toBe(85);
    expect(body('temperature')).toContain('World podium recipes run from 75 to 96 °C, median about 85 °C');
    // "Below 80 °C: only podium recipes from 2009–2015 went there (75–79 °C)."
    const cool = published.filter((c) => (c.recipe!.temp_c ?? 99) < 80);
    expect(Math.max(...cool.map((c) => c.year))).toBeLessThanOrEqual(2015);
    expect(Math.min(...cool.map((c) => c.year))).toBe(2009);
    // The winners the temperature section names, with their coffee and temperature.
    const named: [number, number, string][] = [
      [2023, 89, 'washed Kenya'],
      [2024, 96, 'washed Ethiopia'],
      [2025, 84, 'washed Sidra'],
      [2022, 92, 'natural Striped Red Bourbon'],
      [2021, 80, ''],
    ];
    for (const [year, temp, coffee] of named) {
      expect(winner(year).recipe!.temp_c, String(year)).toBe(temp);
      if (coffee) expect(championCoffee(winner(year)), String(year)).toContain(coffee.split(' ').slice(-1)[0]);
    }
    expect(winner(2024).recipe!.grind_setting).toContain('870 µm');
    expect(winner(2025).recipe!.bypass_temp).toBe('50 °C');
    // "About two thirds of the published podium recipes are inverted."
    const inverted = published.filter((c) => c.recipe!.method === 'Inverted').length / published.length;
    expect(inverted).toBeGreaterThan(0.6);
    expect(inverted).toBeLessThan(0.72);
    // "Winners from 2016 to 2019 used 30–35 g ... where recorded, 100–120 g of bypass."
    const bigDose = [2016, 2017, 2018, 2019].map((y) => winner(y).recipe!);
    expect(Math.min(...bigDose.map((r) => r.dose_g!))).toBe(30);
    expect(Math.max(...bigDose.map((r) => r.dose_g!))).toBe(35);
    expect(bigDose.map((r) => r.bypass_g).filter((g) => g != null).sort()).toEqual([100, 120]);
    expect(body('ratio')).toContain('Winners from 2016 to 2019 used 30–35 g');
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
    expect(askSections('Which water minerals should we use, Third Wave or Aquacode?')).toEqual(['method', 'extraction', 'water', 'troubleshooting']);
    expect(askSections('How long should the beans be resting, and can we freeze them?')).toEqual(expect.arrayContaining(['roast', 'beans']));
    expect(askSections('ما هي درجة حرارة الماء المناسبة للتحميص الفاتح؟')).toEqual(expect.arrayContaining(['temperature', 'roast', 'water']));
    expect(askSections('أي ماء نستخدم؟')).toContain('water');
    expect(askSections('كم يوم يرتاح البن بعد التحميص؟')).toContain('roast');
    // Diacritics and letter forms don't hide a word.
    expect(askSections('ما درجة الحَرارة؟')).toContain('temperature');
    expect(askSections('إيروبرس مقلوب')).toContain('aeropress');
    // A question that names nothing gets the basics and the brewing essentials.
    expect(askSections('What should I try next?')).toEqual(['method', 'extraction', 'temperature', 'grind', 'aeropress', 'troubleshooting']);
    // About a bean: what a coffee needs.
    expect(askSections('What do you think?', 'bean')).toEqual(['method', 'extraction', 'temperature', 'grind', 'beans', 'process', 'roast', 'troubleshooting']);
  });

  it('keeps what a question names, and ignores look-alike words', () => {
    // Names 7 topics: all of them stay, champions and processing included.
    const broad = askSections('Compare the champion’s temperature, grind, ratio and filter on a washed Kenyan');
    expect(broad).toEqual(expect.arrayContaining(['podium', 'temperature', 'grind', 'ratio', 'aeropress', 'process', 'beans']));
    expect(broad).toHaveLength(8);
    // Never more than 8, however much a question names.
    expect(askSections(KNOWLEDGE.map((s) => s.keywords[0]).join(' '))).toHaveLength(8);
    const none = (question: string, id: KnowledgeId) => expect(askSections(question), question).not.toContain(id);
    none('It won’t get sweeter', 'podium');
    none('Is the rest of the recipe fine?', 'roast');
    none('It tastes of green apple', 'sourcing');
    none('We use the AeroPress Original', 'beans');
    none('Press at 1:30', 'ratio');
    none('Any interest in a new routine?', 'roast');
    none('درجة حرارة طبيعية', 'process'); // "a normal temperature"
    none('كيف نتحكم بالطحنة؟', 'sensory'); // "how do we control the grind?"
    expect(fold('إيروبرس الحَرارة won’t')).toBe('ايروبرس الحراره wont');
  });

  it('adds the reference, then the house rules, to the call’s own prompt', () => {
    expect(withReference('You are a coach.', [], null)).toBe('You are a coach.');
    const full = withReference('You are a coach.', ['temperature'], 'Our kettle tops out at 96 °C.');
    expect(full.startsWith('You are a coach.')).toBe(true);
    expect(full).toContain('## Water temperature');
    expect(full).toContain('Amman');
    expect(full.indexOf('<reference>')).toBeLessThan(full.indexOf('<house_rules>'));
    expect(full).toContain('never change the answer format');
    expect(full.trimEnd().endsWith('Our kettle tops out at 96 °C.\n</house_rules>')).toBe(true);
  });
});

describe('the brew read', () => {
  it('is cut at the end of a sentence when it runs long', () => {
    expect(clipToSentence('Short and sweet.', 600)).toBe('Short and sweet.');
    const two = `${'TDS rose by 0.05. '.repeat(20)}And the last sentence runs past the limit.`;
    const cut = clipToSentence(two, 100);
    expect(cut.length).toBeLessThanOrEqual(100);
    expect(cut.endsWith('0.05.')).toBe(true);
    const oneLong = 'word '.repeat(40);
    expect(clipToSentence(oneLong, 50)).toMatch(/word…$/);
    expect(clipToSentence(oneLong, 50).length).toBeLessThanOrEqual(50);
  });
});
