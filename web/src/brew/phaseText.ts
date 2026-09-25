import type { PhaseKind } from '../../../shared/phases';
import type { RecipeFields } from '../../../shared/types';
import { formatGrams, formatSeconds } from '../format';
import { strings } from '../strings';

const b = strings.brew;

export const phaseTitle = (kind: PhaseKind): string => b.phases[kind] ?? kind;

/** What to do in a step, worded from the recipe. */
export function phaseDetail(kind: PhaseKind, r: RecipeFields): string {
  switch (kind) {
    case 'bloom':
      return b.phaseDetail.bloom(r.bloom_water_g ? formatGrams(r.bloom_water_g) : null);
    case 'steep':
      return b.phaseDetail.steep(r.water_g ? formatGrams(r.water_g) : null, r.agitation);
    case 'flip':
      return b.phaseDetail.flip;
    case 'press':
      return b.phaseDetail.press(formatSeconds(r.press_duration_s));
    case 'bypass':
      return b.phaseDetail.bypass(formatGrams(r.bypass_g), r.bypass_temp);
    case 'pour':
      return b.phaseDetail.pour;
  }
}
