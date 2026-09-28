import { env } from 'cloudflare:workers';
import { beforeEach, describe, expect, it } from 'vitest';
import { type BoardResponse, EXPORT_PAGE, type ExportPage, type MeResponse, type RecipeRow, type TeamSettings } from '../../shared/types';
import { TEAM_PIN, addBarista, freshDb, recipeBody, setupTeam, signIn } from './helpers';

beforeEach(freshDb);

const DAY = 86_400_000;
let seq = 0;
const nextId = (prefix: string) => `${prefix}-${String(++seq).padStart(5, '0')}`;

/** Amman date (UTC+3) `days` from today, as YYYY-MM-DD. */
const ammanDate = (days: number) => new Date(Date.now() + 3 * 3600_000 + days * DAY).toISOString().slice(0, 10);

async function insertBrew(o: { team: string; recipe: string; member: string; bean?: string | null; time?: number | null; tds?: number | null; overall?: number | null; at: number }) {
  await env.DB.prepare(
    `INSERT INTO brews (id, team_id, recipe_id, member_id, bean_id, total_time_s, tds_pct, overall, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  )
    .bind(nextId('w'), o.team, o.recipe, o.member, o.bean ?? null, o.time ?? null, o.tds ?? null, o.overall ?? null, o.at)
    .run();
}

async function insertDuel(o: { team: string; x: string; y: string; winner: string | null; bean?: string | null; by: string; judge?: string; at: number }) {
  const id = nextId('d');
  await env.DB.batch([
    env.DB.prepare(
      `INSERT INTO duels (id, team_id, recipe_x_id, recipe_y_id, bean_id, judge_count, status, winner_recipe_id, x_votes, y_votes, created_by, created_at, revealed_at)
       VALUES (?, ?, ?, ?, ?, 1, 'revealed', ?, ?, ?, ?, ?, ?)`,
    ).bind(id, o.team, o.x, o.y, o.bean ?? null, o.winner, o.winner === o.x ? 1 : 0, o.winner === o.y ? 1 : 0, o.by, o.at - 60_000, o.at),
    ...(o.judge ? [env.DB.prepare('INSERT INTO duel_judges (duel_id, member_id) VALUES (?, ?)').bind(id, o.judge)] : []),
  ]);
  return id;
}

/** Owner and Lina; the owner's B beats A five times (Guji is the competition coffee). */
async function boardTeam() {
  const { owner, me } = await setupTeam();
  const team = me.team.id;
  const linaId = await addBarista(owner, 'Lina Haddad');
  const lina = (await signIn(linaId, TEAM_PIN)).client;
  const guji = (await owner.post<{ id: string }>('/api/beans', { name: 'Ethiopia Guji', is_competition_coffee: true })).body;
  const kenya = (await owner.post<{ id: string }>('/api/beans', { name: 'Kenya Nyeri' })).body;
  const a = (await owner.post<RecipeRow>('/api/recipes', recipeBody({ name: 'A' }))).body;
  const b = (await owner.post<RecipeRow>('/api/recipes', recipeBody({ name: 'B' }))).body;
  const c = (await lina.post<RecipeRow>('/api/recipes', recipeBody({ name: 'Lina C' }))).body;
  const now = Date.now();
  for (let i = 0; i < 5; i++) {
    await insertDuel({ team, x: a.id, y: b.id, winner: b.id, bean: i === 0 ? guji.id : kenya.id, by: me.member.id, judge: linaId, at: now - (10 - i) * DAY });
  }
  await insertDuel({ team, x: c.id, y: a.id, winner: c.id, by: linaId, at: now - 2 * DAY });
  return { owner, lina, linaId, team, me, guji, kenya, a, b, c };
}

describe('board', () => {
  it('computes the owner’s team board from the data', async () => {
    const { owner, team, me, guji, kenya, a, b, c, linaId } = await boardTeam();
    const now = Date.now();
    // B: five timed runs under 5:00 on two beans. A: three brews that spread a lot.
    for (let i = 0; i < 5; i++) await insertBrew({ team, recipe: b.id, member: me.member.id, bean: i % 2 ? guji.id : kenya.id, time: 170 + i, tds: 1.35, overall: 8, at: now - i * 3600_000 });
    await insertBrew({ team, recipe: b.id, member: me.member.id, time: 320, at: now - 6 * DAY }); // older, over 5:00
    for (const [tds, overall] of [[1.2, 5], [1.5, 8], [1.35, 7]] as const) await insertBrew({ team, recipe: a.id, member: linaId, tds, overall, at: now - DAY });
    expect((await owner.put(`/api/recipes/${b.id}/lock`, { locked: true })).status).toBe(200);
    expect(
      (await owner.put('/api/team', { name: 'Kurdi Coffee Lab', champ_name: 'Jordan AeroPress Championship', champ_date: ammanDate(10), comp_coffee_notes: null, ai_monthly_budget_usd: 12.5 })).status,
    ).toBe(200);

    const res = await owner.get<BoardResponse>('/api/board');
    expect(res.status).toBe(200);
    const board = res.body;
    expect(board.view).toEqual({ member_id: null, name: null });
    expect(board.champ).toEqual({ name: 'Jordan AeroPress Championship', date: ammanDate(10), days_left: 10 });
    expect(board.comp_coffee).toEqual({ id: guji.id, name: 'Ethiopia Guji' });
    expect(board.locked_recipe?.id).toBe(b.id);
    expect(board.top_recipe?.id).toBe(b.id);

    // Leaderboard: each member's best recipe, best first.
    expect(board.leaderboard.map((e) => [e.name, e.recipe?.id])).toEqual([
      ['Abdelrahman Kurdi', b.id],
      ['Lina Haddad', c.id],
    ]);

    // Elo over time for the top recipes: one point per duel, oldest first.
    const bSeries = board.elo_series.find((s) => s.recipe.id === b.id)!;
    expect(bSeries.points).toHaveLength(5);
    expect(bSeries.points.map((p) => p.elo)).toEqual([...bSeries.points.map((p) => p.elo)].sort((x, y) => x - y));
    expect(bSeries.points.at(-1)?.elo).toBe(board.top_recipe?.elo);

    // Consistency: A spreads (flagged), B is steady.
    const spread = Object.fromEntries(board.consistency.map((row) => [row.recipe.id, row]));
    expect(spread[a.id]).toMatchObject({ brews: 3, unreliable: true });
    expect(spread[a.id]!.tds_sd).toBeCloseTo(0.15, 3);
    expect(spread[b.id]).toMatchObject({ brews: 6, tds_sd: 0, overall_sd: 0, unreliable: false });

    // Volume: 30 days per member; the owner poured six duels' worth of activity, Lina judged five and ran one.
    expect(board.volume.days).toHaveLength(30);
    expect(board.volume.days.at(-1)).toBe(ammanDate(0));
    const volume = Object.fromEntries(board.volume.members.map((m) => [m.name, m]));
    expect(volume['Abdelrahman Kurdi']!.brews.reduce((x, y) => x + y, 0)).toBe(6);
    expect(volume['Abdelrahman Kurdi']!.duels.reduce((x, y) => x + y, 0)).toBe(5);
    expect(volume['Lina Haddad']!.duels.reduce((x, y) => x + y, 0)).toBe(6);
    expect(volume['Abdelrahman Kurdi']!.days_since).toBe(0);

    // Readiness, from the data.
    expect(Object.fromEntries(board.readiness.map((r) => [r.key, [r.done, r.value]]))).toEqual({
      locked: [true, 1],
      wins: [true, 5],
      beans: [true, 2],
      timed: [true, 5],
      comp_duel: [true, 1],
    });
    expect(board.weekly.at(-1)?.brews).toBeGreaterThan(0);
    expect(board.ai).toMatchObject({ configured: false, cap_usd: 12.5, month_spend_usd: 0 });
  });

  it('shows the readiness gaps plainly on a new team', async () => {
    const { owner } = await setupTeam();
    const board = (await owner.get<BoardResponse>('/api/board')).body;
    expect(board.champ.days_left).toBeNull();
    expect(board.top_recipe).toBeNull();
    expect(board.elo_series).toEqual([]);
    expect(board.readiness.every((r) => !r.done)).toBe(true);
    expect(board.readiness.find((r) => r.key === 'comp_duel')?.applicable).toBe(false);
  });

  it('gives baristas their own board; only the owner looks at someone else’s', async () => {
    const { owner, lina, linaId, me, c } = await boardTeam();
    const own = (await lina.get<BoardResponse>('/api/board')).body;
    expect(own.view).toEqual({ member_id: linaId, name: 'Lina Haddad' });
    expect(own.top_recipe?.id).toBe(c.id);
    expect(own.volume.members.map((m) => m.name)).toEqual(['Lina Haddad']);
    expect(own.leaderboard).toHaveLength(2); // the team leaderboard stays team-wide

    const peek = await lina.get(`/api/board?member=${me.member.id}`);
    expect(peek.status).toBe(403);
    const asOwner = await owner.get<BoardResponse>(`/api/board?member=${linaId}`);
    expect(asOwner.body.view.name).toBe('Lina Haddad');
    expect((await owner.get('/api/board?member=nobody')).status).toBe(404);
  });
});

describe('team settings', () => {
  it('lets everyone read them and only the owner change them', async () => {
    const { owner } = await setupTeam();
    const linaId = await addBarista(owner, 'Lina Haddad');
    const lina = (await signIn(linaId, TEAM_PIN)).client;
    const body = { name: 'Kurdi Lab', champ_name: 'JAC 2026', champ_date: '2026-11-20', comp_coffee_notes: 'Washed Ethiopian, light', ai_monthly_budget_usd: 25.555 };

    expect((await lina.put('/api/team', body)).status).toBe(403);
    const saved = await owner.put<TeamSettings>('/api/team', body);
    expect(saved.body).toEqual({ ...body, ai_monthly_budget_usd: 25.56, ai_coach_model: null, ai_quick_model: null, ai_auto_tips: true, coach_rules: null });
    expect((await lina.get<TeamSettings>('/api/team')).body.champ_name).toBe('JAC 2026');
    expect((await owner.get<MeResponse>('/api/me')).body.team).toMatchObject({ name: 'Kurdi Lab', champ_date: '2026-11-20' });

    const badDate = await owner.put('/api/team', { ...body, champ_date: '2026-02-31' });
    expect(badDate.status).toBe(400);
    expect(badDate.body.error.field).toBe('champ_date');
    expect((await owner.put('/api/team', { ...body, ai_monthly_budget_usd: -1 })).status).toBe(400);
    expect((await owner.put('/api/team', { ...body, name: ' ' })).status).toBe(400);
  });
});

describe('backup export', () => {
  it('pages every table for the owner and never includes PIN hashes', async () => {
    const { owner, team, me, a, b, c, linaId } = await boardTeam();
    const now = Date.now();
    const statements = Array.from({ length: EXPORT_PAGE + 1 }, (_, i) =>
      env.DB.prepare('INSERT INTO brews (id, team_id, recipe_id, member_id, created_at) VALUES (?, ?, ?, ?, ?)').bind(nextId('bulk'), team, a.id, me.member.id, now - i),
    );
    await env.DB.batch(statements);

    const lina = (await signIn(linaId, TEAM_PIN)).client;
    expect((await lina.get('/api/export?part=brews')).status).toBe(403);

    const first = await owner.get<ExportPage>('/api/export?part=brews');
    expect(first.body.rows).toHaveLength(EXPORT_PAGE);
    expect(first.body.next).not.toBeNull();
    const second = await owner.get<ExportPage>(`/api/export?part=brews&after=${encodeURIComponent(first.body.next!)}`);
    expect(second.body.rows).toHaveLength(1);
    expect(second.body.next).toBeNull();

    const teamPart = (await owner.get<ExportPage>('/api/export?part=team')).body;
    const members = (await owner.get<ExportPage>('/api/export?part=members')).body;
    const text = JSON.stringify([teamPart, members]);
    expect(text).not.toMatch(/pin_hash|pin_salt|token/);
    expect(members.rows).toHaveLength(2);
    expect((await owner.get<ExportPage>('/api/export?part=duel_judges')).body.rows).toHaveLength(5);
    expect((await owner.get<ExportPage>('/api/export?part=duels')).body.rows).toHaveLength(6);

    // A duel still being judged stays out of the backup, cups and votes included: the owner may be judging it.
    await env.DB.batch([
      env.DB.prepare(
        `INSERT INTO duels (id, team_id, recipe_x_id, recipe_y_id, judge_count, status, created_by, created_at)
         VALUES ('live-duel', ?, ?, ?, 2, 'judging', ?, ?)`,
      ).bind(team, a.id, b.id, linaId, now),
      env.DB.prepare(`INSERT INTO duel_judges (duel_id, member_id) VALUES ('live-duel', ?)`).bind(me.member.id),
      env.DB.prepare(`INSERT INTO duel_judges (duel_id, member_id) VALUES ('live-duel', ?)`).bind(c.owner_member_id),
      env.DB.prepare(`INSERT INTO duel_votes (duel_id, judge_member_id, choice, created_at) VALUES ('live-duel', ?, 'x', ?)`).bind(c.owner_member_id, now),
    ]);
    const exported = JSON.stringify([
      (await owner.get<ExportPage>('/api/export?part=duels')).body,
      (await owner.get<ExportPage>('/api/export?part=duel_judges')).body,
      (await owner.get<ExportPage>('/api/export?part=duel_votes')).body,
    ]);
    expect(exported).not.toContain('live-duel');
    expect((await owner.get('/api/export?part=sessions')).status).toBe(400);
  });
});
