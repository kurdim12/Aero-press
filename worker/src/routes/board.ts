import { Hono } from 'hono';
import { z } from 'zod';
import type { AppEnv } from '../env';
import type {
  BoardRecipe,
  BoardResponse,
  ConsistencyRow,
  LeaderboardEntry,
  ReadinessItem,
  RecipeRow,
  VolumeMember,
  WeeklyScore,
} from '../../../shared/types';
import {
  ACTIVITY_LOOKBACK_DAYS,
  CONSISTENCY_DAYS,
  CONSISTENCY_MIN_BREWS,
  READY_BEANS,
  READY_TIMED_RUNS,
  READY_WINS,
  VOLUME_DAYS,
  WEEKLY_WEEKS,
  daysUntil,
  eloHistory,
  isUnreliable,
  lastDays,
  localDate,
  localDayStart,
  sampleSd,
  timedStreak,
  weekOf,
} from '../../../shared/dashboard';
import { requireMember } from '../middleware/auth';
import { aiSetup, aiUsage, monthSpend } from '../ai/client';
import { TEAM_UTC_OFFSET_MS } from '../ai/config';
import { initialsOf } from '../../../shared/initials';
import { notFound, ownerOnly } from '../lib/errors';
import { listRecipes, loadRevealedDuels } from '../lib/recipes';
import { readQuery } from '../lib/validate';

export const boardRoutes = new Hono<AppEnv>();
boardRoutes.use('*', requireMember);

const boardQuery = z.object({ member: z.string().min(1).max(100).optional() });

/** Brews of one recipe by one member on one day, with the sums behind averages and spreads. */
interface RecentRow {
  recipe_id: string | null;
  member_id: string;
  day: string;
  n: number;
  tds_n: number;
  tds_sum: number | null;
  tds_sq: number | null;
  ov_n: number;
  ov_sum: number | null;
  ov_sq: number | null;
}

interface Spread {
  brews: number;
  tds_n: number;
  tds_sum: number;
  tds_sq: number;
  ov_n: number;
  ov_sum: number;
  ov_sq: number;
}

const toBoardRecipe = (r: RecipeRow): BoardRecipe => ({
  id: r.id,
  display_code: r.display_code,
  name: r.name,
  owner_name: r.owner_name,
  elo: r.elo,
  wins: r.wins,
  losses: r.losses,
  draws: r.draws,
  duels: r.duels,
});

/**
 * Revealed duels since ?3 that each member took part in (the one who poured or hosted, the
 * baristas in a barista duel, and the judges). Bounded by time, so it reads recent duels only.
 */
const PARTICIPANTS = `
  SELECT id AS duel_id, created_by AS member_id FROM duels
   WHERE team_id = ?1 AND status = 'revealed' AND revealed_at >= ?3 AND created_by IS NOT NULL
  UNION
  SELECT id, barista_x_id FROM duels
   WHERE team_id = ?1 AND status = 'revealed' AND revealed_at >= ?3 AND barista_x_id IS NOT NULL
  UNION
  SELECT id, barista_y_id FROM duels
   WHERE team_id = ?1 AND status = 'revealed' AND revealed_at >= ?3 AND barista_y_id IS NOT NULL
  UNION
  SELECT j.duel_id, j.member_id FROM duels dj JOIN duel_judges j ON j.duel_id = dj.id
   WHERE dj.team_id = ?1 AND dj.status = 'revealed' AND dj.revealed_at >= ?3`;

/**
 * GET /api/board: the owner's team dashboard, or one member's own (`?member=<id>`). Baristas
 * always get their own. Aggregates run in D1, so the Worker's CPU stays small.
 */
boardRoutes.get('/', async (c) => {
  const me = c.get('member');
  const db = c.env.DB;
  const team = me.team_id;
  const query = readQuery(c, boardQuery);
  const viewId: string | null = me.role === 'owner' ? (query.member ?? null) : me.id;
  if (me.role !== 'owner' && query.member && query.member !== me.id) throw ownerOnly();

  const now = Date.now();
  const offset = TEAM_UTC_OFFSET_MS;
  const volumeFrom = localDayStart(now, offset, VOLUME_DAYS - 1);
  const weeklyFrom = localDayStart(now, offset, WEEKLY_WEEKS * 7 + 6);
  const spreadFrom = localDayStart(now, offset, CONSISTENCY_DAYS - 1);
  const activityFrom = localDayStart(now, offset, ACTIVITY_LOOKBACK_DAYS - 1);
  // One scan of recent brews serves the weekly scores, the spreads and the activity chart.
  const recentFrom = Math.min(volumeFrom, weeklyFrom, spreadFrom);
  const memberFilter = (col: string) => (viewId ? ` AND ${col} = ?` : '');
  const memberArg = () => (viewId ? [viewId] : []);

  const duels = await loadRevealedDuels(db, team);
  const [teamRow, compBean, members, recipes, recent, duelDays, lastBrews, spend] = await Promise.all([
    db.prepare('SELECT champ_name, champ_date FROM teams WHERE id = ?').bind(team).first<{ champ_name: string | null; champ_date: string | null }>(),
    db
      .prepare('SELECT id, name FROM beans WHERE team_id = ? AND is_competition_coffee = 1 LIMIT 1')
      .bind(team)
      .first<{ id: string; name: string }>(),
    db
      .prepare('SELECT id, name, role FROM members WHERE team_id = ? AND active = 1 ORDER BY created_at')
      .bind(team)
      .all<{ id: string; name: string; role: string }>(),
    listRecipes(db, team, { duels }),
    db
      .prepare(
        `SELECT recipe_id, member_id, date((created_at + ?) / 1000, 'unixepoch') AS day, COUNT(*) AS n,
                COUNT(tds_pct) AS tds_n, SUM(tds_pct) AS tds_sum, SUM(tds_pct * tds_pct) AS tds_sq,
                COUNT(overall) AS ov_n, SUM(overall) AS ov_sum, SUM(overall * overall) AS ov_sq
           FROM brews WHERE team_id = ? AND created_at >= ?${memberFilter('member_id')}
          GROUP BY recipe_id, member_id, day`,
      )
      .bind(offset, team, recentFrom, ...memberArg())
      .all<RecentRow>(),
    // Duels per member per day: they feed the chart, and the latest is the member's last duel.
    db
      .prepare(
        `SELECT p.member_id, date((d.revealed_at + ?2) / 1000, 'unixepoch') AS day, COUNT(*) AS n, MAX(d.revealed_at) AS last
           FROM duels d JOIN (${PARTICIPANTS}) p ON p.duel_id = d.id
          WHERE d.team_id = ?1 AND d.status = 'revealed' AND d.revealed_at >= ?3
          GROUP BY p.member_id, day`,
      )
      .bind(team, offset, activityFrom)
      .all<{ member_id: string; day: string; n: number; last: number }>(),
    // Each member's latest brew: one index lookup each (idx_brews_team_member_created).
    db
      .prepare(
        `SELECT m.id AS member_id,
                (SELECT MAX(w.created_at) FROM brews w WHERE w.team_id = m.team_id AND w.member_id = m.id) AS last
           FROM members m WHERE m.team_id = ? AND m.active = 1`,
      )
      .bind(team)
      .all<{ member_id: string; last: number | null }>(),
    monthSpend(db, team),
  ]);

  const viewMember = viewId ? members.results.find((m) => m.id === viewId) : null;
  if (viewId && !viewMember) throw notFound('member');

  const byId = new Map(recipes.map((r) => [r.id, r]));
  const ranked = recipes.filter((r) => r.duels > 0); // already best first
  const mine = viewId ? ranked.filter((r) => r.owner_member_id === viewId) : ranked;
  const locked = recipes.find((r) => r.locked) ?? null;

  const leaderboard: LeaderboardEntry[] = members.results
    .map((m) => {
      const best = ranked.find((r) => r.owner_member_id === m.id);
      return { member_id: m.id, name: m.name, initials: initialsOf(m.name), recipe: best ? toBoardRecipe(best) : null };
    })
    .sort((a, b) => (b.recipe?.elo ?? -1) - (a.recipe?.elo ?? -1));

  const top3 = mine.slice(0, 3);
  const history = eloHistory(duels, top3.map((r) => r.id));
  const eloSeries = top3.map((r) => ({ recipe: toBoardRecipe(r), points: history.get(r.id) ?? [] }));

  const weeklyDay = localDate(weeklyFrom, offset);
  const spreadDay = localDate(spreadFrom, offset);
  const weeks = new Map<string, { total: number; n: number }>();
  const spreads = new Map<string, Spread>();
  const brewsByMemberDay = new Map<string, number>();
  for (const row of recent.results) {
    if (row.day >= weeklyDay && row.ov_n > 0) {
      const w = weeks.get(weekOf(row.day)) ?? { total: 0, n: 0 };
      w.total += row.ov_sum ?? 0;
      w.n += row.ov_n;
      weeks.set(weekOf(row.day), w);
    }
    if (row.recipe_id && row.day >= spreadDay) {
      const sp = spreads.get(row.recipe_id) ?? { brews: 0, tds_n: 0, tds_sum: 0, tds_sq: 0, ov_n: 0, ov_sum: 0, ov_sq: 0 };
      sp.brews += row.n;
      sp.tds_n += row.tds_n;
      sp.tds_sum += row.tds_sum ?? 0;
      sp.tds_sq += row.tds_sq ?? 0;
      sp.ov_n += row.ov_n;
      sp.ov_sum += row.ov_sum ?? 0;
      sp.ov_sq += row.ov_sq ?? 0;
      spreads.set(row.recipe_id, sp);
    }
    const key = `${row.member_id}|${row.day}`;
    brewsByMemberDay.set(key, (brewsByMemberDay.get(key) ?? 0) + row.n);
  }
  const weekly: WeeklyScore[] = [...weeks.entries()]
    .sort(([a], [b]) => (a < b ? -1 : 1))
    .slice(-WEEKLY_WEEKS)
    .map(([week, w]) => ({ week, avg_overall: Math.round((w.total / w.n) * 100) / 100, brews: w.n }));

  const round = (v: number | null, digits: number) => (v === null ? null : Number(v.toFixed(digits)));
  const consistency: ConsistencyRow[] = [...spreads.entries()]
    .filter(([, row]) => row.brews >= CONSISTENCY_MIN_BREWS)
    .flatMap(([recipeId, row]) => {
      const recipe = byId.get(recipeId);
      if (!recipe) return [];
      const tdsSd = round(sampleSd(row.tds_n, row.tds_sum ?? 0, row.tds_sq ?? 0), 3);
      const overallSd = round(sampleSd(row.ov_n, row.ov_sum ?? 0, row.ov_sq ?? 0), 2);
      return [{ recipe: toBoardRecipe(recipe), brews: row.brews, tds_sd: tdsSd, overall_sd: overallSd, unreliable: isUnreliable(tdsSd, overallSd) }];
    })
    .sort((a, b) => Number(b.unreliable) - Number(a.unreliable) || b.brews - a.brews);

  const days = lastDays(now, offset, VOLUME_DAYS);
  const dayIndex = new Map(days.map((d, i) => [d, i]));
  const lastSeen = new Map<string, number>();
  for (const row of [...lastBrews.results, ...duelDays.results]) {
    if (row.last !== null) lastSeen.set(row.member_id, Math.max(lastSeen.get(row.member_id) ?? 0, row.last));
  }
  const todayStart = localDayStart(now, offset);
  const volumeMembers: VolumeMember[] = members.results
    .filter((m) => !viewId || m.id === viewId)
    .map((m) => {
      const brews = days.map(() => 0);
      const duelsPerDay = days.map(() => 0);
      days.forEach((day, i) => {
        brews[i] = brewsByMemberDay.get(`${m.id}|${day}`) ?? 0;
      });
      for (const row of duelDays.results) if (row.member_id === m.id && dayIndex.has(row.day)) duelsPerDay[dayIndex.get(row.day)!] = row.n;
      const last = lastSeen.get(m.id) ?? null;
      const daysSince = last === null ? null : Math.max(0, Math.ceil((todayStart - last) / 86_400_000));
      return { member_id: m.id, name: m.name, initials: initialsOf(m.name), brews, duels: duelsPerDay, last_active: last, days_since: daysSince };
    });

  const readiness = await readinessFor(db, team, locked, compBean);

  return c.json<BoardResponse>({
    view: { member_id: viewId, name: viewMember?.name ?? null },
    champ: {
      name: teamRow?.champ_name ?? null,
      date: teamRow?.champ_date ?? null,
      days_left: daysUntil(teamRow?.champ_date ?? null, now, offset),
    },
    comp_coffee: compBean ?? null,
    locked_recipe: locked ? toBoardRecipe(locked) : null,
    top_recipe: mine[0] ? toBoardRecipe(mine[0]) : null,
    leaderboard,
    elo_series: eloSeries,
    weekly,
    consistency,
    volume: { days, members: volumeMembers },
    readiness,
    ai: aiUsage(aiSetup(c.env), spend),
  });
});

/** The championship checklist, from the data rather than self-reported. */
async function readinessFor(
  db: D1Database,
  team: string,
  locked: RecipeRow | null,
  compBean: { id: string } | null,
): Promise<ReadinessItem[]> {
  // Any revealed duel on the competition coffee counts, barista duels included.
  const compDuels = compBean
    ? ((
        await db
          .prepare(`SELECT COUNT(*) AS n FROM duels WHERE team_id = ? AND bean_id = ? AND status = 'revealed'`)
          .bind(team, compBean.id)
          .first<{ n: number }>()
      )?.n ?? 0)
    : 0;
  let beans = 0;
  let streak = 0;
  if (locked) {
    const [beanRow, times] = await Promise.all([
      db
        .prepare(
          `SELECT COUNT(DISTINCT bean_id) AS n FROM (
             SELECT bean_id FROM brews WHERE team_id = ?1 AND recipe_id = ?2 AND bean_id IS NOT NULL
             UNION
             SELECT bean_id FROM duels WHERE team_id = ?1 AND status = 'revealed' AND bean_id IS NOT NULL
                AND (recipe_x_id = ?2 OR recipe_y_id = ?2))`,
        )
        .bind(team, locked.id)
        .first<{ n: number }>(),
      db
        .prepare(
          `SELECT total_time_s FROM brews WHERE team_id = ? AND recipe_id = ? AND total_time_s IS NOT NULL
            ORDER BY created_at DESC LIMIT ?`,
        )
        .bind(team, locked.id, READY_TIMED_RUNS)
        .all<{ total_time_s: number }>(),
    ]);
    beans = beanRow?.n ?? 0;
    streak = timedStreak(times.results.map((t) => t.total_time_s));
  }
  const wins = locked?.wins ?? 0;
  return [
    { key: 'locked', done: locked !== null, value: locked ? 1 : 0, target: 1, applicable: true },
    { key: 'wins', done: wins >= READY_WINS, value: wins, target: READY_WINS, applicable: true },
    { key: 'beans', done: beans >= READY_BEANS, value: beans, target: READY_BEANS, applicable: true },
    { key: 'timed', done: streak >= READY_TIMED_RUNS, value: streak, target: READY_TIMED_RUNS, applicable: true },
    { key: 'comp_duel', done: compDuels >= 1, value: compDuels, target: 1, applicable: compBean !== null },
  ];
}
