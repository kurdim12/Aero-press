// The coach's coffee reference: what a World AeroPress Championship coach should know, checked
// against published sources (listed per section). Every coach call gets the sections that fit its
// job (worker/src/ai/knowledge.ts), and "What the coach knows" shows all of it to the team.
// Bodies are plain text: short paragraphs, and "- " lines for lists. The podium section is
// computed from the champion library, so it always matches it.
import { CHAMPION_RECIPES, type ChampionRecipe } from './champions';

export const KNOWLEDGE_IDS = [
  'method',
  'extraction',
  'temperature',
  'grind',
  'ratio',
  'aeropress',
  'water',
  'beans',
  'process',
  'roast',
  'sourcing',
  'sensory',
  'competition',
  'troubleshooting',
  'podium',
] as const;
export type KnowledgeId = (typeof KNOWLEDGE_IDS)[number];

export interface KnowledgeSource {
  label: string;
  url: string;
}

export interface KnowledgeSection {
  id: KnowledgeId;
  title: string;
  /** One line for the list on "What the coach knows". */
  summary: string;
  /** Lower-case words that bring this section into an answer when a question contains them. */
  keywords: readonly string[];
  body: string;
  sources: readonly KnowledgeSource[];
}

// ---------- The podium section, computed from the champion library ----------

const nums = (values: (number | null | undefined)[]) => values.filter((v): v is number => typeof v === 'number' && Number.isFinite(v));

function median(values: number[]): number {
  const s = [...values].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 === 1 ? s[mid]! : (s[mid - 1]! + s[mid]!) / 2;
}

const oneDecimal = (n: number) => String(Math.round(n * 10) / 10);
const range = (values: number[], unit: string) => `${oneDecimal(Math.min(...values))}–${oneDecimal(Math.max(...values))}${unit}`;
const clock = (s: number) => `${Math.floor(s / 60)}:${String(Math.round(s % 60)).padStart(2, '0')}`;

/** The coffee a champion brewed, when the notes name it ("Coffee: …."). */
export const championCoffee = (c: ChampionRecipe): string | null => /Coffee: (.+?)\.(?: |$)/.exec(c.notes ?? '')?.[1] ?? null;

/** A recipe in a line, from its fields, for a champion whose full method isn't published. */
function fieldsLine(r: NonNullable<ChampionRecipe['recipe']>): string {
  const parts = [
    r.method,
    r.dose_g != null && r.water_g != null ? `${r.dose_g} g coffee, ${r.water_g} g water` : null,
    r.temp_c != null ? `${r.temp_c} °C` : null,
    r.bloom_water_g === 0 ? 'no bloom' : r.bloom_water_g ? `bloom ${r.bloom_water_g} g${r.bloom_ends_s ? ` to ${clock(r.bloom_ends_s)}` : ''}` : null,
    r.agitation,
    r.press_starts_s != null ? `press at ${clock(r.press_starts_s)}${r.press_duration_s ? ` for ${r.press_duration_s} s` : ''}` : null,
    r.bypass_g ? `bypass ${r.bypass_g} g${r.bypass_temp ? ` at ${r.bypass_temp}` : ''}` : null,
  ];
  return parts.filter(Boolean).join('; ');
}

/** A winner in full: the coffee, the kit and the published method (which has the dilution). */
function winnerLine(c: ChampionRecipe): string {
  const r = c.recipe!;
  const coffee = championCoffee(c);
  const parts = [
    coffee ? `Coffee: ${coffee}.` : null,
    r.grinder ? `Grinder: ${r.grinder}${r.grind_setting ? `, ${r.grind_setting}` : ''}.` : r.grind_setting ? `Grind: ${r.grind_setting}.` : null,
    r.filter ? `Filter: ${r.filter}.` : null,
    r.water_recipe ? `Water: ${r.water_recipe}.` : null,
    `Method: ${r.other_steps ?? `${fieldsLine(r)}.`}`,
  ];
  return `- ${c.year} ${c.name} (${c.country}), ${r.temp_c != null ? `${r.temp_c} °C` : 'temperature not published'}. ${parts.filter(Boolean).join(' ')}`;
}

/** Filter wording in the library that means it was rinsed or wetted ("dry (not rinsed)" isn't). */
const RINSED = /(?<!not )(rinse|wet|soak)/;
/** Two filters stacked: two papers, or paper with metal. */
const TWO_FILTERS = /\b(2|two)\b[^,;]*?\bpaper|paper filter plus|plus 1 metal|metal filter plus/;

/** Medians, ranges and patterns over the published podium recipes, and the recent winners in full. */
export function podiumBody(champions: readonly ChampionRecipe[]): string {
  const all = champions.filter((c) => c.recipe !== null);
  const recipes = all.map((c) => c.recipe!);
  const years = all.map((c) => c.year);
  const inverted = recipes.filter((r) => r.method === 'Inverted').length;
  const standard = recipes.filter((r) => r.method === 'Standard').length;
  const doses = nums(recipes.map((r) => r.dose_g));
  const water = nums(recipes.map((r) => r.water_g));
  const temps = nums(recipes.map((r) => r.temp_c));
  const bloomKnown = recipes.filter((r) => r.bloom_water_g != null);
  const blooms = nums(bloomKnown.map((r) => r.bloom_water_g)).filter((g) => g > 0);
  const pressStarts = nums(recipes.map((r) => r.press_starts_s)).filter((s) => s > 0);
  const pressTimes = nums(recipes.map((r) => r.press_duration_s)).filter((s) => s > 0);
  const bypass = nums(recipes.map((r) => r.bypass_g)).filter((g) => g > 0);
  // Some top up to a target weight instead of adding a set amount: no amount, but a bypass water.
  const toppedUp = recipes.filter((r) => r.bypass_g == null && r.bypass_temp != null).length;
  const undiluted = recipes.filter((r) => r.bypass_g === 0).length;
  const filters = recipes.map((r) => (r.filter ?? '').toLowerCase());
  const rinsed = filters.filter((f) => RINSED.test(f)).length;
  const doubled = filters.filter((f) => TWO_FILTERS.test(f)).length;
  const metal = filters.filter((f) => f.includes('metal')).length;
  const paper = filters.filter((f) => /paper|aesir|kalita|cafec/.test(f)).length;
  const recent = all.filter((c) => c.year >= 2021);
  const recentDoses = nums(recent.map((c) => c.recipe!.dose_g));
  const sameRecentDose = recentDoses.length > 0 && recentDoses.every((d) => d === recentDoses[0]);
  const winners = all.filter((c) => c.place === 1).sort((a, b) => b.year - a.year);
  const winnerTemps = winners.filter((c) => c.recipe!.temp_c != null).map((c) => `${c.year} ${c.recipe!.temp_c} °C`);
  const recentWinners = winners.filter((c) => c.year >= 2021);

  return [
    `${all.length} published podium recipes from ${Math.min(...years)} to ${Math.max(...years)} (winners, second and third places; not every place was published).`,
    `- Method: ${inverted} inverted, ${standard} upright.`,
    `- Coffee: median ${oneDecimal(median(doses))} g (${range(doses, ' g')}). ${
      sameRecentDose
        ? `Every podium recipe since 2021 uses ${recentDoses[0]} g, the WAC’s cap since that year.`
        : `Since 2021 (the WAC’s dose cap): ${range(recentDoses, ' g')}.`
    }`,
    `- Brew water: median ${oneDecimal(median(water))} g (${range(water, ' g')}).`,
    `- Water temperature: median ${oneDecimal(median(temps))} °C (${range(temps, ' °C')}). Winners: ${winnerTemps.join(', ')}.`,
    `- Bloom: ${blooms.length} of the ${bloomKnown.length} recipes that record it use one (median ${oneDecimal(median(blooms))} g of water); the rest pour everything at once.`,
    `- The press starts at a median ${clock(median(pressStarts))} (${clock(Math.min(...pressStarts))}–${clock(Math.max(...pressStarts))}) and takes a median ${oneDecimal(median(pressTimes))} s (${range(pressTimes, ' s')}).`,
    `- Dilution: ${bypass.length + toppedUp} recipes dilute the concentrate with water: ${bypass.length} add a set amount (median ${oneDecimal(median(bypass))} g) and ${toppedUp} top up to a target drink weight. ${undiluted} serve it undiluted; the rest don’t say.`,
    `- Filters: ${paper} of ${recipes.length} use paper; ${rinsed} say the filter is rinsed or wetted; ${doubled} stack two filters; ${metal} add a metal filter.`,
    '',
    'Recent winners in full, with the coffee they were given:',
    ...recentWinners.map(winnerLine),
  ]
    .join('\n')
    .replace(/(\d) (°C|µm|ppm|g|s)(?=[\s,.;:)]|$)/gm, '$1 $2');
}

// ---------- The sections ----------

const WAC_RULES: KnowledgeSource[] = [
  { label: 'Indian AeroPress Championship: rules (2024, following the WAC)', url: 'https://www.indianaeropresschampionship.com/rules-regulations' },
  { label: 'Swiss AeroPress Championship: guidelines and rules 2024', url: 'https://swissaeropress.coffee/guidelines-and-rules-2024/' },
  { label: 'Perfect Daily Grind: what’s next for the WAC (the 18 g cap)', url: 'https://perfectdailygrind.com/2023/11/whats-next-aeropress-world-championship/' },
];
const AEROPRESS_HEAT: KnowledgeSource = {
  label: 'AeroPress help: heat loss while brewing, and recommended temperatures',
  url: 'https://help.aeropress.com/en-US/does-aeropress-steel-lose-significant-amounts-of-heat-due-to-its-all-stainless-steel-design-4840327',
};
const PROCESSING_DATA: KnowledgeSource = {
  label: 'Coffee ad Astra: the effects of varieties, origin and processing',
  url: 'https://coffeeadastra.com/2020/09/05/the-effects-of-varieties-origin-and-processing/',
};

export const KNOWLEDGE: readonly KnowledgeSection[] = [
  {
    id: 'method',
    title: 'Dialling in and testing',
    summary: 'How to change a recipe and prove the change: the order of the levers, step sizes, tasting, blind duels, a new coffee on the day.',
    keywords: [' dial', 'adjust', 'tweak', 'improve', 'experiment', 'variable', 'consisten', 'repeatab', 'routine', 'session', 'practi', 'training', 'ضبط', 'تجرب', 'تحسين', 'تدريب'],
    body: `Split every problem into two questions before touching a setting:
- Extraction: is the cup under-extracted (sour, salty, thin, short), over-extracted (bitter, drying), or uneven (sour and bitter at once, hollow)? That is how much of the coffee dissolved. Fix it first, with grind, agitation, steep time and temperature.
- Strength: is it too strong or too weak? That is how much dissolved coffee is in the drink (TDS). Fix it last, with dose, brew water or bypass.

The levers, strongest first in an AeroPress:
- Grind size: the biggest lever on extraction, and it changes how the press feels.
- Agitation and steep time: stirring and swirling speed extraction up and even it out. Extraction is fastest at the start, so the first minute matters most.
- Water temperature: hotter extracts more and faster. Read the temperature section before moving it.
- Dose, brew water and bypass: they set strength and volume more than extraction.

Steps a trained palate can pick up: 1–2 clicks on a hand grinder (grinder-specific), 2–3 °C, 15–20 s of steep, 0.5–1 g of coffee, 10–20 g of bypass, one stir more or less. Change one variable per test; two only when they belong together and you say why (a finer grind with a shorter steep, to change the grind without changing the total time).

Tasting a test:
- Taste every cup hot, warm and near room temperature. A competition cup holds or improves as it cools; one that turns sour or thin as it cools loses heads-up.
- Confirm with a blind duel: identical cups and volumes, the same serving temperature, someone else placing the cups. One duel is a hint; two or three agreeing duels are evidence.
- Brew a promising recipe at least twice more before trusting it. A recipe that only works when everything goes right is not a competition recipe.
- With a refractometer, log TDS for every brew, so taste and numbers can be read together.

A new coffee on the day (the organiser’s coffee often arrives the evening before):
- Brew the base recipe unchanged first and note what the cup does.
- Move grind first, one step at a time; then steep time or agitation; then temperature. Leave dose and ratio alone unless strength is the problem.
- Stop early: lock the recipe with time left to rehearse it, and write it on a card.`,
    sources: [],
  },
  {
    id: 'extraction',
    title: 'Strength and extraction',
    summary: 'TDS, extraction yield, what under- and over-extraction taste like, and how to read AeroPress numbers.',
    keywords: ['extract', ' tds', ' ey ', 'yield', 'strength', ' strong', ' weak', 'refractometer', 'concentration', 'استخلاص', 'تركيز'],
    body: `- Strength (TDS, total dissolved solids, %): how much of the drink is dissolved coffee.
- Extraction yield (EY, %): how much of the dry coffee ended up dissolved. The app computes it as TDS % × drink weight (g) ÷ dose (g).
- The SCA’s “golden cup” for filter coffee is 1.15–1.35 % TDS at 18–22 % extraction (about 55 g of coffee per litre). In 2023 UC Davis and the SCA published a new brewing control chart that maps flavours (sour, bitter, sweet, astringent, fruity and more) across strength and extraction, and found consumers split into groups with different favourite zones. There is no single ideal: judge the cup, and use the numbers to repeat it.
- Under-extracted: sour (sharp rather than juicy), salty, thin, short, little sweetness. Very light roasts can also taste grassy or like raw peanuts.
- Over-extracted: bitter, drying, woody, a harsh finish. True over-extraction is rarer than it seems: a drying, astringent cup is often uneven extraction (channelling, fines) rather than too much.
- Uneven: sour and bitter at once, with nothing in the middle (hollow). Part of the coffee over-extracted while part barely extracted.
- In between: sweetness, balance and clarity. That is the target for a blind heat.
- Strength is a separate question: a well-extracted cup can still be too strong (heavy, flavours blurred) or too weak (watery, short). Fix strength with bypass, dose or water, not with grind.
- What raises extraction: a finer grind, hotter water, a longer steep, more agitation, rested (degassed) coffee. The opposite lowers it.

Reading AeroPress numbers:
- In an immersion brew the wet grounds keep back liquid as strong as the cup (roughly 1.2–2 g per gram of coffee; recent winners pressed about 75 g of concentrate out of 100 g of water and 18 g of coffee). The drink-weight formula leaves out what they hold, so the app’s EY reads lower than the true extraction.
- Immersion formulas count it: EY ≈ TDS × brew water ÷ dose, or TDS × brew water ÷ (dose × (1 − TDS)), with TDS as a fraction and bypass left out. The gap grows with concentration: about 2–3 points at 1:12–1:15, and about 4–7 points for an 18 g : 100 g concentrate, where an app EY of 13–15 % can be a normal 19–21 % extraction. Never call a concentrate under-extracted from the app’s EY alone. Compare brews with the same formula, and AeroPress brews with each other, not with pour-over numbers.
- At full equilibrium, immersion extraction stays close to 21 % across brew ratios (UC Davis, 2021): a concentrate plus bypass is mainly a way to set strength, volume and serving temperature separately.
- Bypass lowers TDS but doesn’t change how much was extracted.
- Measure the same way every time (the same sample point and temperature) and trust a trend over several brews more than one reading.`,
    sources: [
      { label: 'Guinard et al. (2023): a new coffee brewing control chart (J. Food Science)', url: 'https://ift.onlinelibrary.wiley.com/doi/10.1111/1750-3841.16531' },
      { label: 'Coffee ad Astra: a more accurate way to calculate extraction yield', url: 'https://coffeeadastra.com/2019/02/20/a-more-accurate-way-to-calculate-average-extraction-yield/' },
      { label: 'Liang, Chan & Ristenpart (2021): equilibrium extraction in full immersion (Scientific Reports)', url: 'https://www.nature.com/articles/s41598-021-85787-1' },
    ],
  },
  {
    id: 'temperature',
    title: 'Water temperature',
    summary: 'What temperature does, what champions used (75–96 °C), when to go hotter or cooler, altitude in Amman and Mexico City, heat loss in the brewer.',
    keywords: ['temp', '°c', ' degree', ' hot', ' cool', ' cold', ' boil', 'kettle', ' heat', 'thermometer', 'altitude', 'elevation', 'حرارة', 'حراره', 'غلي', 'غلاية', 'سخن', 'ساخن', 'بارد'],
    body: `What it does:
- Hotter water extracts faster and further: more sweetness and body at first, then bitterness and roast notes if pushed. Cooler water extracts less and more slowly: gentler, but sour, thin or salty unless a finer grind, a longer steep or more stirring makes up for it.
- Temperature works mostly through how much it extracts. When UC Davis adjusted grind and time so strength and extraction matched, drip coffee brewed at 87, 90 and 93 °C tasted almost the same to a trained panel (2020). Bigger gaps do change flavour (studies from cold brew to 92 °C). So move temperature together with grind and time, and judge the cup, not the number.

What the AeroPress world does:
- AeroPress’s own guidance is 85 °C for light and medium roasts and 80 °C for dark roasts. Many baristas brew light roasts either around 80 °C or above 90 °C.
- World podium recipes run from 75 to 96 °C, median about 85 °C. Winners since 2021: 2025 84 °C, 2024 96 °C, 2023 89 °C, 2022 92 °C, 2021 80 °C. Both cool and hot recipes win; what matters is that grind, steep, agitation and dose are built around the temperature for the coffee in hand.
- The 2024 winner paired 96 °C with a coarse grind (about 870 µm). Tuomas Merikanto (2021 winner) found his 95 °C national recipe tasted sour and tannic on the very light competition roast, and won at 80 °C with a coarser grind and gentler stirring. Hotter is not always sweeter, and cooler is not always safer.

Choosing a temperature for a coffee:
- Everyday brewing advice: light, dense, washed, high-grown coffees get hotter water (about 91–96 °C); darker roasts get cooler water (80–88 °C), because bitterness and roast notes rise with heat.
- Competition practice is looser. WAC coffees are nearly all light, high-grown specialty lots, and winners brewed them anywhere from 80 to 96 °C: a washed Kenya at 89 °C (2023), a washed Ethiopia at 96 °C (2024), a washed Sidra at 84 °C (2025), a natural Bourbon at 92 °C (2022). The bands are a starting point, not an answer: pick a style (cooler with more contact, or hotter with less), build grind, steep and agitation around it, and let blind duels decide.
- Naturals, anaerobic and co-fermented lots: many roasters brew them a few degrees cooler and more gently to keep ferment notes clean. A tendency only: the 2022 winner brewed a natural at 92 °C.
- A cup that stays sour, salty or short after going finer: go hotter. A cup that dries the mouth: go gentler first (see Fixing a cup), then cooler.
- Below 80 °C: only podium recipes from 2009–2015 went there (75–79 °C). Treat it as an experiment that needs a strong reason.
- Steps of 2–3 °C. A jump of 5 °C or more is a change of style: rethink the grind and the time with it.
- Always say why a temperature suits this coffee, and which grind, steep and dose go with it.

Altitude and boiling point:
- Water boils about 1 °C lower for every 300 m of altitude.
- Amman spans roughly 700–1,100 m, so water boils there at about 96.5–97.7 °C. A kettle set to 100 °C only reaches the local boil, and a sea-level recipe written at 97–100 °C can’t be copied exactly.
- The 2026 world final is listed for Mexico City, about 2,240 m up, where water boils near 92.5 °C. There a hot-water recipe has to be rebuilt (finer grind, longer steep, more stirring), not copied.

Heat in the brewer:
- The chamber takes heat the moment the water touches it, and the air takes more during the steep. Preheating (rinsing the chamber and cap with hot water) raises the starting temperature but barely slows the loss. Small brews cool faster than big ones.
- Nobody has published a reliable figure for the drop, so measure the slurry once with a probe thermometer and brew from the real number.
- Kettle displays can be off by a degree or two: check the kettle with a thermometer too.
- Bypass water may be any temperature. Cool bypass (the 2025 winner used 50 °C) brings the cup to drinking temperature fast; hot bypass keeps it hot longer. Serve at a temperature where the cup already tastes sweet.`,
    sources: [
      { label: 'Batali et al. (2020): brew temperature and sensory profile at matched extraction (Scientific Reports)', url: 'https://www.nature.com/articles/s41598-020-73341-4' },
      AEROPRESS_HEAT,
      { label: 'Interview with Tuomas Merikanto, 2021 world champion (European Coffee Trip)', url: 'https://europeancoffeetrip.com/interview-tuomas-merikanto/' },
      { label: 'Boiling point of water at altitude (Engineering ToolBox)', url: 'https://www.engineeringtoolbox.com/boiling-points-water-altitude-d_1344.html' },
      { label: 'Amman: elevation (Wikipedia)', url: 'https://en.wikipedia.org/wiki/Amman' },
      { label: 'WAC 2026 event listings', url: 'https://worldaeropresschampionship.com/pages/2026-event-listings' },
    ],
  },
  {
    id: 'grind',
    title: 'Grind',
    summary: 'Grind size, fines and boulders, burrs, sifting, static and frozen beans.',
    keywords: ['grind', ' ground', ' click', 'micron', 'µm', ' burr', ' fines', ' finer', 'boulder', ' sift', 'sieve', 'kruve', ' rdt', 'static', 'particle', 'coarse', 'comandante', '1zpresso', 'zp6', 'kinu', 'ek43', 'طحن', 'مطحن', 'ناعم', 'خشن'],
    body: `- Grind size sets how much coffee surface the water meets. Finer means faster extraction, more resistance on the press and more fines. It is the strongest extraction lever in the AeroPress.
- Settings mean nothing across grinders, so log the grinder with every setting. Microns help when known: a Comandante C40 click is about 30 µm, a Red Clix click about 15 µm.
- Every grinder makes a spread of sizes. Fines (particles under about 100 µm) extract fastest, add body and sediment, and in excess clog the paper, slow the press and cause channelling and harshness. Boulders (the largest pieces) under-extract and add sourness.
- Rule of thumb: burrs that make fewer fines (many flat burrs built for filter) give more clarity; burrs that make more fines give more body. Both have won.
- Sifting: shaking out the fines buys clarity and lets you run hotter or longer. It is a competition practice rather than a studied one: the 2025 winner sifted at 200 µm, and the 2022 winner and the 2014 third place also removed fines. It removes coffee, so weigh the dose after sifting.
- Static: a few drops of water on the beans before grinding (RDT, up to about 20 µL per gram) cut static and clumping; in a 2023 study it also made espresso more consistent. Grind the same way every time (the 2025 winner ground slowly).
- Frozen beans grind a little finer and more evenly (strongly so only far colder than a home freezer). Straight from the freezer, expect to go a click or so coarser to match.
- Reading the press: too fine gives a hard press or a stall and a muddy, drying cup; too coarse falls through with little resistance and tastes sour and thin. A steady press with even resistance is the usual sign of a matched grind.
- Podium grinds run from medium-fine to coarse on many different grinders: compare them by what they do, not by the number.`,
    sources: [
      { label: 'Uman et al. (2016): grinding coffee at different bean temperatures (Scientific Reports)', url: 'https://www.nature.com/articles/srep24483' },
      { label: 'Méndez Harper et al. (2023): moisture, static and clumping in coffee grinding (Matter)', url: 'https://www.cell.com/matter/fulltext/S2590-2385(23)00568-4' },
      { label: 'Coffee ad Astra: the physics of fines migration', url: 'https://coffeeadastra.com/2020/02/01/the-physics-of-fines-migration/' },
    ],
  },
  {
    id: 'ratio',
    title: 'Dose, ratio and bypass',
    summary: 'The dose cap, brewing a concentrate, bypass, and reaching the serving volume.',
    keywords: [' ratio', ' dose', ' dosing', ' gram', 'bypass', 'dilut', 'concentrate', 'volume', ' ml ', 'top up', 'نسبة', 'جرعة', 'تخفيف', 'بايباس', 'كمية'],
    body: `- Brew ratio = brew water ÷ coffee. Pour-over usually runs about 1:15–1:17. Many AeroPress champions brew a concentrate (about 1:5–1:10) and dilute it with bypass water.
- Why a concentrate: a small brew is quick to steep and press, and bypass then sets strength, volume and serving temperature on its own. Baristas often add that a stronger slurry extracts less; in full immersion the effect is small (see Strength and extraction), so let taste decide.
- Bypass changes strength, not extraction. Dial extraction with grind, time, agitation and temperature; set strength last with bypass.
- More coffee at the same water raises strength and body.

Competition limits:
- The WAC has capped the dose at 18 g since 2021 (some 2024 national rulebooks say 20 g; check the current rules). Less is allowed.
- Every world podium recipe since 2021 used 18 g. Winners from 2016 to 2019 used 30–35 g with coarse grinds (and, where recorded, 100–120 g of bypass), which is no longer legal.
- At least 150 ml has to be served. The wet grounds keep roughly 1.2–2 g of water per gram of coffee, so plan the drink weight (brew water minus what the grounds keep, plus bypass) with a margin, and weigh it in practice.
- Recent winners brewed about 100 g of water through 18 g of coffee, pressed out about 60–80 g of concentrate, and diluted it to about 150–165 g: a set amount of bypass, or topping up to a target weight.`,
    sources: WAC_RULES,
  },
  {
    id: 'aeropress',
    title: 'AeroPress technique',
    summary: 'Inverted or upright, the Flow Control cap, filters, bloom, stirring, steep, press and the 5-minute routine.',
    keywords: ['aeropress', 'invert', 'upright', ' standard', ' flip', ' press', 'plunger', 'filter', 'paper', 'metal', 'bloom', ' stir', 'swirl', 'agitat', 'steep', ' hiss', 'flow control', 'rinse', 'ايروبرس', 'إيروبرس', 'أيروبرس', 'مقلوب', 'كبس', 'فلتر', 'تقليب', 'تحريك', 'نقع'],
    body: `The brewer:
- WAC rules allow only the AeroPress Original or Clear, unaltered (not the Go, XL or Premium). The Flow Control filter cap is allowed from the 2025 season.
- Inverted (upside down, flipped onto the cup to press): true full immersion, nothing drips during the steep. The flip must be practised (the app allows 10 s for it).
- Upright (standard): some water drips through during the steep, a little percolation. Seating the plunger a few millimetres into the chamber holds a vacuum; the Flow Control cap’s valve holds the liquid until you press. The 2025 winner brewed upright with the Flow Control cap and two papers.
- About two thirds of the published podium recipes are inverted.

Filters:
- Paper gives the cleanest cup. Rinse it with hot water to wash out paper taste and warm the cap (one 2022 podium recipe used a dry paper on purpose, so taste it).
- Two papers, or a thicker paper such as Aesir, slow the flow and add clarity. Metal lets oils and fines through: more body, some silt. Any material is allowed if it tastes neutral.

Bloom:
- A small first pour (about 2–3 times the dose in water) with a stir or swirl lets CO₂ escape and wets every particle before the main pour. It matters most with fresh coffee.
- Many podium recipes skip it and stir the full pour instead. Test it on the coffee in hand.

Agitation:
- Stirring and swirling raise extraction and even it out. They are also the biggest source of brew-to-brew differences: script them (how many stirs, which direction, when, with what).

Steep and press:
- Extraction goes on until the press ends, fastest at the start.
- Press slowly and steadily (the podium median is 30 s). A gentle press keeps the bed from compacting and pushes less silt through; a hard press channels and forces fines out.
- Stop at the hiss (air coming through the grounds) unless tests say pressing through tastes better: the last liquid is the most bitter and silty.

The routine:
- Preheat everything. Weigh the coffee and the water every time. Start the timer at first contact. Keep pour speed and kettle fill the same.
- Stir the final cup: concentrate and bypass sit in layers.
- Everything, grinding included, must fit the 5 minutes. The app’s plan times only the brew (first pour to serving) against 5:00, so leave room for grinding and setup.`,
    sources: [
      ...WAC_RULES.slice(0, 2),
      { label: 'AeroPress launches the Flow Control filter cap (April 2023)', url: 'https://www.prnewswire.com/news-releases/aeropress-launches-flow-control-filter-cap-for-enhanced-coffee-brewing-experience-301791484.html' },
      AEROPRESS_HEAT,
    ],
  },
  {
    id: 'water',
    title: 'Water',
    summary: 'The SCA water targets, alkalinity and hardness, what champions brewed with, and practical water for the team.',
    keywords: ['mineral', ' ppm', 'hardness', 'alkalin', 'buffer', 'bicarbonate', 'magnesium', 'calcium', 'third wave', 'aquacode', 'lotus', ' apax', 'perfect coffee water', 'reverse osmosis', ' ro ', 'distilled', 'tap water', 'bottled', 'water recipe', 'which water', 'what water', 'our water', 'معادن', 'عسر', 'قلوي', 'مياه', 'ماء', 'فلترة'],
    body: `- Water is about 98 % of the cup, and its minerals change how it tastes. A new water means a new dial-in.
- SCA water standard: calcium hardness 68 mg/L as CaCO₃ (17–85 acceptable), total alkalinity at or near 40 mg/L, TDS 150 mg/L (75–250), pH 7 (6.5–7.5), sodium at or near 10 mg/L, no chlorine, clean and odourless.
- Alkalinity (the bicarbonate buffer) is the biggest taste lever. Too much neutralises acidity, and the cup goes flat and chalky; too little lets acidity turn sharp.
- Magnesium and calcium: a 2014 computer model found magnesium binds flavour compounds more strongly than calcium, which gave rise to “magnesium for fruit, calcium for body”. A 2024 experiment found drinking-water levels of either barely changed how much acid was extracted; minerals may change how the cup tastes more than what it extracts. Choose water by blind tasting.
- Pure RO or distilled water brews flat and empty. Hard, high-alkalinity tap water mutes the cup and scales the kettle.
- Champions mostly brewed with soft, low-alkalinity water: 30 ppm Spa Blauw (2019), diluted Aquacode around 85–90 ppm (2024), Perfect Coffee Water (2022, 2023), Third Wave Water blends (2021), 125 ppm from an APAX Lab prototype (2025).
- Competitors may bring their own water unless the host provides competition water. It must taste neutral, and the head judge can refuse it. Practise with the exact water you will compete with.
- In practice: build from RO or distilled water plus a known mineral recipe (Third Wave Water, APAX or Lotus drops, or a measured magnesium, calcium and bicarbonate mix), so every brew, in Amman and at the venue, uses the same water. A TDS meter shows only the total; hardness and alkalinity drop tests show the balance.`,
    sources: [
      { label: 'SCA: dissecting the water quality standard', url: 'https://scanews.coffee/2013/07/08/dissecting-scaas-water-quality-standard/' },
      { label: 'Hendon et al. (2014): the role of dissolved cations in coffee extraction (J. Agric. Food Chem.)', url: 'https://pubs.acs.org/doi/10.1021/jf501687c' },
      { label: 'Bratthäll et al. (2024): water minerals and acid extraction (Heliyon)', url: 'https://www.ncbi.nlm.nih.gov/pmc/articles/PMC10907646/' },
      WAC_RULES[0]!,
    ],
  },
  {
    id: 'beans',
    title: 'Varieties, origins and density',
    summary: 'What a coffee’s variety, origin, altitude and density suggest about its flavour and how it extracts.',
    keywords: [' bean', 'variet', 'cultivar', ' origin ', ' origins', 'single origin', 'ethiopia', 'kenya', 'colombia', 'panama', 'costa rica', 'guatemala', 'brazil', 'rwanda', 'burundi', 'yemen', 'ecuador', ' peru', 'honduras', 'indonesia', 'geisha', 'gesha', 'sidra', 'bourbon', 'typica', 'caturra', 'catuai', 'pacamara', 'sl28', 'sl34', '74110', 'altitude', 'masl', 'density', ' dense', 'حبوب', 'صنف', 'سلالة', 'منشأ', 'اثيوب', 'كيني', 'كولومبي', 'جيشا', 'ارتفاع', 'كثافة'],
    body: `These are tendencies; the coffee in the cup decides.

Varieties:
- Gesha (Geisha): jasmine, bergamot, stone fruit, a tea-like body. Delicate; rewards clarity (paper, gentle agitation).
- SL28 and SL34 (Kenya): blackcurrant, a savoury tomato-like sweetness, intense acidity.
- Ethiopian landraces (74110, 74112 and other heirlooms): floral, citrus, stone fruit, tea-like.
- Bourbon (red, yellow, pink): sweet and round; Pink Bourbon floral and citric.
- Typica: clean, sweet, delicate. Caturra and Catuaí: bright, lighter body.
- Pacamara: large beans, intense, anywhere from herbal and savoury to tropical.
- Sidra (Ecuador, Colombia): floral, fruity, complex. The 2025 world final coffee was a washed Sidra from Ecuador.
- Castillo and other rust-resistant Colombian varieties: balanced, sweet, sometimes less distinct.

Origins (typical, with many exceptions):
- Ethiopia: floral, citrus, stone fruit. Kenya: bright, blackcurrant, juicy.
- Colombia: balanced, red fruit, caramel. Panama: famous for floral Gesha.
- Costa Rica: clean, sweet, often honey-processed. Guatemala: cocoa with bright acidity.
- Brazil: nutty, chocolate, low acidity. Yemen: winey, spiced. Indonesia: earthy, herbal, heavy.
- Rwanda and Burundi: red fruit and black tea. Watch for the “potato” defect: a raw-potato smell from a single bad bean.

Altitude and density:
- Coffee grown higher ripens more slowly and is usually denser, with more acidity and complexity.
- Rule of thumb (not a measured law): dense, high-grown beans want more extraction (finer, hotter or longer); soft, low-grown beans less. Check it by taste and refractometer.
- Large beans (Pacamara, Maragogype) can grind differently from small ones at the same setting.`,
    sources: [PROCESSING_DATA],
  },
  {
    id: 'process',
    title: 'Processing',
    summary: 'Washed, natural, honey, anaerobic and co-fermented coffees: how they taste and how to brew them.',
    keywords: ['processing', 'processed', ' washed', ' natural', 'honey', 'anaerobic', 'carbonic', 'ferment', 'infused', 'thermal shock', 'yeast', 'hulled', 'pulped', 'decaf', 'معالجة', 'مغسول', 'مجفف', 'ناتشورال', 'عسلي', 'تخمير', 'لاهوائي'],
    body: `- Washed: the fruit is removed before drying. Clean, bright, transparent; shows the variety and the place. Usually brewed for a full extraction (finer, hotter) to bring out its sweetness.
- Natural (dry): dried inside the whole cherry. Fruit-forward, heavier body, winey, sometimes fermenty.
- Honey and pulped natural: in between; sweetness and body.
- Anaerobic, carbonic maceration, yeast-inoculated, thermal-shock, co-fermented or infused lots: intense, sometimes boozy, spiced or candy-like, with fragile aromatics. Judges can love or dislike process flavours, so taste them blind with people outside the team.
- Wet-hulled (Indonesia): earthy, herbal, heavy body, low acidity.
- How to brew them: roasters often advise naturals and fermented lots a little cooler (for example 92 rather than 96 °C), coarser and with gentler agitation, to keep ferment notes clean. That is taste advice, not extraction science: in a large dataset washed coffees extracted slightly more than naturals on average. Test it both ways.`,
    sources: [PROCESSING_DATA, { label: 'Scott Rao: extraction myths', url: 'https://www.scottrao.com/blog/extraction-myths' }],
  },
  {
    id: 'roast',
    title: 'Roast, rest and storage',
    summary: 'Roast level and development, resting after roasting, staling, storing and freezing.',
    keywords: ['roast', 'resting', ' rested', 'rest time', 'rest period', 'rest days', 'let it rest', 'let them rest', 'degas', ' fresh', 'stale', 'days off', 'freez', 'frozen', 'storage', ' store', 'valve', 'agtron', 'underdevelop', 'baked', 'تحميص', 'محمص', 'راحة', 'يرتاح', 'ترتاح', 'طازج', 'قديم', 'تجميد', 'فريزر', 'تخزين'],
    body: `- Roast level: lighter roasts keep more acidity and origin character and usually need more energy to taste sweet (finer, hotter, longer). Darker roasts bring roast bitterness and body, which rise with water temperature: go cooler, coarser or shorter. (“Dark roasts extract more easily” rarely shows up in measured extraction; the reason to brew them cooler is taste.) Competition coffees are usually light filter roasts.
- Development: an underdeveloped light roast tastes grassy, like raw peanuts, sour and drying even when brewed well; finer and hotter only partly helps. A baked roast tastes flat, bready or papery. Know which it is before blaming the recipe.
- Rest: fresh coffee releases CO₂, which pushes water away and extracts unevenly (sharp, hollow cups). Rules of thumb: whole beans stay fresh for about 3 weeks (SCA); many light filter roasts taste best from about 1 to 3 weeks off roast; very light or dense coffees can need longer. With very fresh coffee, bloom longer and stir more. The data gives each coffee’s days off roast: always read it.
- Staling: aroma fades over the weeks after the bag is opened; old coffee tastes flat and papery.
- Freezing: beans frozen airtight at about −20 °C kept their fresh aroma for 9 weeks in a sensory study, and a year frozen did little harm in another test. Freeze single doses in airtight containers and grind them straight from the freezer (see Grind). Don’t open a cold container in humid air: condensation. With single doses, any condensation touches only that dose.
- Competition coffee: find out its roast date and practise on coffee of the same age.`,
    sources: [
      { label: 'SCA Coffee Decoded: fresh coffee', url: 'https://sca.coffee/sca-news/coffee-decoded-9-fresh-coffee' },
      { label: 'Cotter & Hopfer (2018): freezing roasted coffee (Beverages)', url: 'https://doi.org/10.3390/beverages4030068' },
      { label: 'Barista Hustle: a year in the deep freeze', url: 'https://www.baristahustle.com/a-year-in-the-deep-freeze/' },
    ],
  },
  {
    id: 'sourcing',
    title: 'Sourcing and green coffee',
    summary: 'What makes coffee specialty, what to ask a roaster, and how to practise for an unknown competition coffee.',
    keywords: [' sourc', ' buy', 'green coffee', 'green bean', 'importer', ' farm', 'producer', 'harvest', ' crop', 'cup of excellence', ' grade', 'grading', 'defect', 'moisture', 'water activity', 'auction', ' cva', 'مصدر', 'توريد', 'أخضر', 'مزرعة', 'محصول', 'عيوب', 'شراء'],
    body: `- Specialty grade (SCA): in a 350 g sample of green coffee, no category-1 defects and at most 5 full defects (smaller defects are counted in equivalents, such as 5 broken beans for 1 full defect). Moisture about 10–12 % (older texts say 9–13 %), and water activity below 0.70.
- Scoring: the classic cupping form gave one score out of 100, with 80+ for specialty. Since 2024 the SCA’s Coffee Value Assessment keeps four parts apart: physical (defects, moisture, size), descriptive (what the coffee tastes like), affective (how much the taster likes it) and extrinsic (traceability, certifications, processing).
- Freshness of the green coffee: new-crop coffee tastes vivid; past-crop coffee tastes papery, woody or flat. Ask for the harvest date.
- Ask the roaster: producer and farm, variety, process (with the fermentation details), altitude, harvest date, roast date, roast level, and how long they recommend resting it.
- Training for the WAC: the organiser supplies one coffee to everyone, whole bean, often the evening before. Practise on a range of coffees (a washed high-grown coffee from Ethiopia, Kenya or Colombia, a natural, and whatever resembles recent competition coffees). The goal is a routine that adapts in a few brews, not a recipe that fits one bag.`,
    sources: [
      { label: 'SCA: the Coffee Value Assessment', url: 'https://sca.coffee/value-assessment' },
      { label: 'SCAA green coffee grading (reproduced by 33 Ton Coffee)', url: 'https://www.33toncoffee.com/learn/coffee-defects/scaa-coffee-grading.html' },
    ],
  },
  {
    id: 'sensory',
    title: 'Tasting and judging',
    summary: 'How WAC judges decide, what wins blind, tasting as the cup cools, and calibrating the team’s judges.',
    keywords: ['taste', 'tasting', ' judg', ' score', 'flavor', 'flavour', ' sweet', 'acidity', 'acidic', ' body', 'mouthfeel', 'clarity', ' finish', 'aftertaste', 'palate', 'calibrat', 'cupping', 'aroma', 'تذوق', 'طعم', 'حكام', 'تحكيم', ' الحكم ', 'حموضة', 'حلاوة', 'قوام', 'صفاء', 'نكهة'],
    body: `- At the WAC, three judges taste a heat’s three cups blind. Each decides privately which is “the cup I would most like to drink all of”, and all three point at once on a count of three. Two votes win; if all three point at different cups, the head judge tastes and decides. There is no score sheet.
- What wins: sweetness, balance, clarity (distinct flavours, not muddled), pleasant acidity, a clean and lasting finish, enough body to feel good. Intensity alone rarely wins; a defect (sourness, bitterness, dryness, ferment) usually loses.
- Temperature: judges keep tasting as the cup cools. As it cools, bitterness and roast notes fade and sourness reads more strongly; below about 44 °C fruit and other non-roast flavours come through more clearly. That is why cuppers judge sweetness and cleanliness in the cooled cup, and why a sour or thin cup gets worse as it cools. A cup must taste good from hot to warm.
- Team judging: taste blind, at the same time and temperature, from identical cups. Score the six criteria (sweetness, acidity, body, clarity, finish, overall) before pointing, and talk about the cups only after everyone has pointed.
- Words: acidity (juicy and bright, or sharp and sour); sweetness; body (tea-like to syrupy); clarity; finish (long and sweet, or short, drying, bitter); balance.
- Common flaws: sour, bitter, astringent (drying), muddy or silty, papery, woody, fermenty or boozy, baked, grassy, potato.`,
    sources: [
      ...WAC_RULES.slice(0, 2),
      { label: 'Adhikari et al. (2019): serving temperature and coffee flavour (Food Research International)', url: 'https://www.sciencedirect.com/science/article/abs/pii/S0963996918306203' },
      { label: 'Steen et al. (2017): coffee aroma and flavour as it cools (Food Chemistry)', url: 'https://www.sciencedirect.com/science/article/abs/pii/S0308814616315084' },
    ],
  },
  {
    id: 'competition',
    title: 'The World AeroPress Championship',
    summary: 'The rules that shape a recipe (time, dose, brewer, water, volume), the format, Jordan’s qualifier, and strategy.',
    keywords: ['competition', 'championship', ' compet', ' wac', ' heat', ' round', ' final', ' rule', ' stage', 'venue', 'time limit', '5 min', 'five min', 'national', 'qualif', 'mexico', ' judg', 'بطولة', 'مسابقة', 'منافسة', 'قوانين', 'نهائي', 'تصفيات'],
    body: `Rules that shape a recipe (WAC rules as of 2024–2025; national events follow them with local changes, so check the current rulebook):
- 5 minutes to prepare, brew and present, grinding included. Heating water, weighing doses, assembling the brewer and fitting the filter may happen before the clock starts.
- The dose is capped at 18 g since 2021 (some 2024 national rulebooks say 20 g). Less is allowed.
- At least 150 ml served, in identical vessels the organisers provide.
- AeroPress Original or Clear only, unaltered. The Flow Control cap is allowed from 2025. Filters of any material, if they taste neutral.
- Only coffee and water go in. Bypass water may be any temperature; ice is allowed.
- Competitors bring their own grinder, kettle, scale, water and tools (thermometer, sieve, RDT or WDT tools, stirrer). The water must taste neutral, the head judge can refuse it, and the host may impose a competition water.
- One organiser coffee for everyone, whole bean, often handed out the evening before (2025 world final: around 10 pm, final at noon the next day). Some national events send practice bags a week or two ahead.

Format:
- Heats of three competitors and three judges, tasting blind and pointing at once (see Tasting and judging). The winner of each heat goes through.
- Jordan held a national qualifier in 2022 (at the Jordan Coffee Festival in Amman, with heats in Aqaba and Irbid) and is listed for 2026.
- The 2026 world final is listed for Mexico City in December, about 2,240 m up (see Water temperature).

Strategy:
- Build a recipe that holds up across coffees, and a short plan for adapting it (grind first).
- Rehearse the whole routine against the clock until it finishes with a comfortable margin; rehearse the flip, the pours and the press.
- Practise with the exact water, grinder and kettle you will compete with. Bring spares (filters, scale batteries, a spare grinder if allowed).
- Serve a cup that already tastes good at the temperature the judges will taste it, and stays good as it cools.
- Keep the stage routine calm and identical: weigh everything, time everything.`,
    sources: [
      ...WAC_RULES,
      { label: 'WAC 2025 world final (Seoul)', url: 'https://worldaeropresschampionship.com/pages/2025-world-aeropress-championship' },
      { label: 'WAC 2026 event listings', url: 'https://worldaeropresschampionship.com/pages/2026-event-listings' },
      { label: 'Jordan’s first coffee festival and AeroPress qualifier (Jordan News, 2022)', url: 'https://www.jordannews.jo/Section-114/All/Jordan-s-first-coffee-festival-Competitions-and-music-20855' },
    ],
  },
  {
    id: 'troubleshooting',
    title: 'Fixing a cup',
    summary: 'What you taste, the likely cause, and what to change first.',
    keywords: [' sour ', 'sourness', ' bitter', 'astring', ' dry', 'drying', 'harsh', ' thin', 'watery', ' weak', 'muddy', 'silty', ' flat', ' dull', 'hollow', 'boozy', ' stall', ' clog', 'hard to press', 'too strong', ' fix', 'problem', 'wrong', 'حامض', 'مرارة', 'قابض', 'ضعيف', 'مائي', 'مشكلة'],
    body: `What you taste → the likely cause → the first change (one at a time):
- Sour, sharp, salty, thin, short → under-extracted → 1–2 clicks finer, or 2–3 °C hotter, or 15–30 s more steep, or more stirring. Very fresh coffee? Bloom longer.
- Bitter, harsh, ashy → over-extracted, or a dark roast → 1–2 clicks coarser, or 2–3 °C cooler, or a shorter steep; press gently and stop at the hiss.
- Drying, astringent, tannic → usually uneven extraction (channelling, too many fines, pressing past the hiss), sometimes an underdeveloped roast → coarser or sifted, gentler stirring, a gentler press that stops at the hiss; cooler water can help (the 2021 world champion’s fix).
- Sour and bitter at once (hollow) → uneven extraction: dry clumps, channelling, an uneven grind → stir the bloom well, even the bed, use a more even grind or sift.
- Weak and watery but clean → strength, not extraction → less bypass, or more coffee (within the dose cap), or less water.
- Heavy, muddled, flavours blurred → too strong, or silty → more bypass; paper instead of metal, or two papers; sift out fines.
- Flat, dull → stale coffee, high-alkalinity water, or under-extraction → fresher coffee, softer water, a notch finer.
- Boozy, fermenty, harsh on a natural or anaerobic coffee → too hot or too much agitation → cooler, gentler, slightly coarser.
- Hard to press, or it stalls → too fine, too many fines, or too thick a filter → coarser, sift, one paper.
- Different every time → the routine → script the stirring, pours, timing and press; weigh everything; check the kettle with a thermometer.`,
    sources: [],
  },
  {
    id: 'podium',
    title: 'What the podium recipes show',
    summary: 'Numbers from every published World AeroPress Championship podium recipe in the app’s library.',
    keywords: ['champion', 'winner', ' won ', 'podium', 'بطل', 'أبطال', 'ابطال', 'فائز'],
    body: podiumBody(CHAMPION_RECIPES),
    sources: [{ label: 'WAC recipes (official)', url: 'https://worldaeropresschampionship.com/pages/recipes' }],
  },
];
