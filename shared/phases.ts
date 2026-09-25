// Brew-mode steps generated from a recipe, and the 5-minute check.
import type { RecipeFields } from './types';

export const FLIP_S = 10;
export const BYPASS_S = 15;
export const POUR_S = 15;
/** Each competitor has 5 minutes to brew one cup. */
export const WINDOW_S = 300;

export type PhaseKind = 'bloom' | 'steep' | 'flip' | 'press' | 'bypass' | 'pour';

export interface BrewPhase {
  kind: PhaseKind;
  /** Seconds from the start of the brew. */
  start: number;
  end: number;
}

export interface BrewPlan {
  phases: BrewPhase[];
  /** Planned total in seconds (end of the last phase). */
  total: number;
  /** True when the planned total fits in the 5-minute window. */
  fits: boolean;
  /** Recipe fields the timer needs but the recipe doesn't have; the plan stops before them. */
  missing: Array<'press_starts_s' | 'press_duration_s'>;
}

export type PlanInput = Pick<RecipeFields, 'method' | 'bloom_ends_s' | 'press_starts_s' | 'press_duration_s' | 'bypass_g'>;

/**
 * 1. Bloom until bloom_ends_s. 2. Pour, agitate, cap and steep until press_starts_s.
 * 3. Flip (10 s, inverted only). 4. Press for press_duration_s. 5. Bypass (15 s, if any).
 * 6. Pour into the judging cup (15 s).
 */
export function planBrew(r: PlanInput): BrewPlan {
  const phases: BrewPhase[] = [];
  let t = 0;
  const add = (kind: PhaseKind, seconds: number) => {
    if (seconds <= 0) return;
    phases.push({ kind, start: t, end: t + seconds });
    t += seconds;
  };

  add('bloom', r.bloom_ends_s ?? 0);

  const missing: BrewPlan['missing'] = [];
  if (r.press_starts_s == null) missing.push('press_starts_s');
  if (r.press_duration_s == null) missing.push('press_duration_s');
  if (missing.length > 0) return { phases, total: t, fits: t <= WINDOW_S, missing };

  add('steep', (r.press_starts_s ?? 0) - t);
  if (r.method === 'Inverted') add('flip', FLIP_S);
  add('press', r.press_duration_s ?? 0);
  if ((r.bypass_g ?? 0) > 0) add('bypass', BYPASS_S);
  add('pour', POUR_S);

  return { phases, total: t, fits: t <= WINDOW_S, missing };
}

/**
 * Which phase is running at `elapsed` seconds: its index, or phases.length once the
 * last one has ended (the brew is done). A phase starts at `start` and ends before `end`.
 */
export function phaseIndexAt(plan: Pick<BrewPlan, 'phases'>, elapsed: number): number {
  const i = plan.phases.findIndex((p) => elapsed < p.end);
  return i === -1 ? plan.phases.length : i;
}
