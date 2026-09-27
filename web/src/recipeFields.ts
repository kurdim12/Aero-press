// How each recipe setting is labelled and displayed, shared by the detail and compare views.
import type { RecipeFields, RecipeRow } from '../../shared/types';
import { formatGrams, formatRatio, formatSeconds, formatTemp } from './format';
import { strings } from './strings';

const f = strings.recipes.fields;

/** What the display needs: the recipe's settings and its bean's name (a champion's has none). */
export type DisplayRecipe = RecipeFields & Pick<RecipeRow, 'bean_name'>;

export interface DisplayField {
  key: string;
  label: string;
  show: (r: DisplayRecipe) => string;
}

const text = (v: string | null) => v ?? '';

export const RECIPE_DISPLAY_FIELDS: DisplayField[] = [
  { key: 'bean', label: f.bean, show: (r) => text(r.bean_name) },
  { key: 'method', label: f.method, show: (r) => strings.recipes.methods[r.method] ?? r.method },
  { key: 'filter', label: f.filter, show: (r) => text(r.filter) },
  { key: 'dose', label: f.dose, show: (r) => formatGrams(r.dose_g) },
  { key: 'water', label: f.water, show: (r) => formatGrams(r.water_g) },
  { key: 'ratio', label: f.ratio, show: (r) => formatRatio(r.water_g, r.dose_g) ?? '' },
  { key: 'temp', label: f.temp, show: (r) => formatTemp(r.temp_c) },
  { key: 'grinder', label: f.grinder, show: (r) => text(r.grinder) },
  { key: 'grind', label: f.grind, show: (r) => text(r.grind_setting) },
  { key: 'waterRecipe', label: f.waterRecipe, show: (r) => text(r.water_recipe) },
  { key: 'bloomWater', label: f.bloomWater, show: (r) => formatGrams(r.bloom_water_g) },
  { key: 'bloomEnds', label: f.bloomEnds, show: (r) => formatSeconds(r.bloom_ends_s) },
  { key: 'agitation', label: f.agitation, show: (r) => text(r.agitation) },
  { key: 'pressStarts', label: f.pressStarts, show: (r) => formatSeconds(r.press_starts_s) },
  { key: 'pressDuration', label: f.pressDuration, show: (r) => formatSeconds(r.press_duration_s) },
  { key: 'bypass', label: f.bypass, show: (r) => formatGrams(r.bypass_g) },
  { key: 'bypassTemp', label: f.bypassTemp, show: (r) => text(r.bypass_temp) },
  { key: 'otherSteps', label: f.otherSteps, show: (r) => text(r.other_steps) },
  { key: 'notes', label: f.notes, show: (r) => text(r.notes) },
];

/** Labels by recipe column, for AI experiment changes and prefilled drafts. */
export const COLUMN_LABELS: Record<keyof RecipeFields, string> = {
  name: f.name,
  bean_id: f.bean,
  method: f.method,
  filter: f.filter,
  dose_g: f.dose,
  water_g: f.water,
  temp_c: f.temp,
  grinder: f.grinder,
  grind_setting: f.grind,
  water_recipe: f.waterRecipe,
  bloom_water_g: f.bloomWater,
  bloom_ends_s: f.bloomEnds,
  agitation: f.agitation,
  press_starts_s: f.pressStarts,
  press_duration_s: f.pressDuration,
  bypass_g: f.bypass,
  bypass_temp: f.bypassTemp,
  other_steps: f.otherSteps,
  notes: f.notes,
};

/** One recipe column's value as the app shows it (a bean id shows as the bean's name). */
export function formatColumn(key: keyof RecipeFields, value: unknown, beanName: (id: string) => string | undefined = () => undefined): string {
  if (value === null || value === undefined || value === '') return strings.common.none;
  switch (key) {
    case 'dose_g':
    case 'water_g':
    case 'bloom_water_g':
    case 'bypass_g':
      return typeof value === 'number' ? formatGrams(value) : String(value);
    case 'temp_c':
      return typeof value === 'number' ? formatTemp(value) : String(value);
    case 'bloom_ends_s':
    case 'press_starts_s':
    case 'press_duration_s':
      return typeof value === 'number' ? formatSeconds(value) : String(value);
    case 'method':
      return strings.recipes.methods[String(value)] ?? String(value);
    case 'bean_id':
      return beanName(String(value)) ?? strings.common.none;
    default:
      return String(value);
  }
}
