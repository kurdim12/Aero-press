// The Board's numbers: thresholds and the pure calculations behind them (tested in test/unit).
import { WINDOW_S } from './phases';
import { type EloDuel, replayElo } from './elo';

/** A recipe whose TDS or overall score spreads this much (standard deviation) is flagged. */
export const UNRELIABLE_TDS_SD = 0.08;
export const UNRELIABLE_OVERALL_SD = 1;
/** Consistency needs at least this many brews of a recipe, within the last CONSISTENCY_DAYS. */
export const CONSISTENCY_MIN_BREWS = 3;
export const CONSISTENCY_DAYS = 90;
export const VOLUME_DAYS = 30;
/** How far back "last session" looks for duels (brews use their whole history, via an index). */
export const ACTIVITY_LOOKBACK_DAYS = 30;
export const WEEKLY_WEEKS = 12;
/** Readiness targets. */
export const READY_WINS = 5;
export const READY_BEANS = 2;
export const READY_TIMED_RUNS = 5;

const DAY_MS = 86_400_000;

/** YYYY-MM-DD of an instant, in the team's time zone. */
export const localDate = (ms: number, offsetMs: number): string => new Date(ms + offsetMs).toISOString().slice(0, 10);

/** Epoch ms of the start of the local day `days` days before today (0 = today). */
export function localDayStart(now: number, offsetMs: number, daysBack = 0): number {
  const local = new Date(now + offsetMs);
  return Date.UTC(local.getUTCFullYear(), local.getUTCMonth(), local.getUTCDate() - daysBack) - offsetMs;
}

/** The last `count` local days, oldest first, as YYYY-MM-DD. */
export function lastDays(now: number, offsetMs: number, count: number): string[] {
  return Array.from({ length: count }, (_, i) => localDate(localDayStart(now, offsetMs, count - 1 - i), offsetMs));
}

/** The Monday of a YYYY-MM-DD day's week. */
export function weekOf(day: string): string {
  const t = Date.parse(`${day}T00:00:00Z`);
  const weekday = (new Date(t).getUTCDay() + 6) % 7; // Monday 0 … Sunday 6
  return new Date(t - weekday * DAY_MS).toISOString().slice(0, 10);
}

/** Whole days from today (team time) until a YYYY-MM-DD date; negative once it's past. */
export function daysUntil(date: string | null, now: number, offsetMs: number): number | null {
  if (!date || !/^\d{4}-\d{2}-\d{2}$/.test(date)) return null;
  const target = Date.parse(`${date}T00:00:00Z`);
  if (Number.isNaN(target)) return null;
  const today = Date.parse(`${localDate(now, offsetMs)}T00:00:00Z`);
  return Math.round((target - today) / DAY_MS);
}

/** Sample standard deviation from a count, a sum and a sum of squares; null below 2 values. */
export function sampleSd(n: number, sum: number, sumSq: number): number | null {
  if (n < 2) return null;
  return Math.sqrt(Math.max(0, (sumSq - (sum * sum) / n) / (n - 1)));
}

export const isUnreliable = (tdsSd: number | null, overallSd: number | null): boolean =>
  (tdsSd ?? 0) >= UNRELIABLE_TDS_SD || (overallSd ?? 0) >= UNRELIABLE_OVERALL_SD;

/** How many of the latest timed runs in a row finished inside 5:00 (times newest first). */
export function timedStreak(timesNewestFirst: readonly number[]): number {
  let n = 0;
  for (const t of timesNewestFirst) {
    if (t >= WINDOW_S) break;
    n++;
  }
  return n;
}

/** Each listed recipe's Elo after every duel it played, oldest first. */
export function eloHistory(duels: readonly EloDuel[], recipeIds: readonly string[]): Map<string, { t: number; elo: number }[]> {
  const wanted = new Set(recipeIds);
  const history = new Map<string, { t: number; elo: number }[]>(recipeIds.map((id) => [id, []]));
  replayElo(duels, {
    onDuel: (d, x, y) => {
      if (wanted.has(d.recipe_x_id)) history.get(d.recipe_x_id)?.push({ t: d.revealed_at, elo: Math.round(x.elo) });
      if (wanted.has(d.recipe_y_id)) history.get(d.recipe_y_id)?.push({ t: d.revealed_at, elo: Math.round(y.elo) });
    },
  });
  return history;
}
