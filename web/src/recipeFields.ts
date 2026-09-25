// How each recipe setting is labelled and displayed, shared by the detail and compare views.
import type { RecipeRow } from '../../shared/types';
import { formatGrams, formatRatio, formatSeconds, formatTemp } from './format';
import { strings } from './strings';

const f = strings.recipes.fields;

export interface DisplayField {
  key: string;
  label: string;
  show: (r: RecipeRow) => string;
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
