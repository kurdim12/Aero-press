import { beforeEach, describe, expect, it } from 'vitest';
import type { BaristaStandingsResponse, BoardResponse, DuelView, DuelsResponse, ExportPage, RecipeRow, RecipesResponse } from '../../shared/types';
import { type Client, TEAM_PIN, addBarista, freshDb, judgeScores, recipeBody, setupTeam, signIn, vote } from './helpers';

beforeEach(freshDb);

/** Owner hosts; Lina and Omar compete; Sara and Yousef judge. */
async function team() {
  const { owner } = await setupTeam();
  const a = (await owner.post<RecipeRow>('/api/recipes', recipeBody({ name: 'Lina’s bloom', temp_c: 92 }))).body;
  const b = (await owner.post<RecipeRow>('/api/recipes', recipeBody({ name: 'Omar’s cooler', temp_c: 85 }))).body;
  const people: Record<string, { id: string; client: Client }> = {};
  for (const name of ['Lina Haddad', 'Omar Saleh', 'Sara Nasser', 'Yousef Amin']) {
    const id = await addBarista(owner, name);
    people[name.split(' ')[0]!] = { id, client: (await signIn(id, TEAM_PIN)).client };
  }
  const { Lina: lina, Omar: omar, Sara: sara, Yousef: yousef } = people as Record<'Lina' | 'Omar' | 'Sara' | 'Yousef', { id: string; client: Client }>;
  return { owner, a, b, lina, omar, sara, yousef };
}

const baristaDuel = (t: Awaited<ReturnType<typeof team>>, extra: Record<string, unknown> = {}) => ({
  kind: 'baristas',
  barista_a_id: t.lina.id,
  recipe_a_id: t.a.id,
  barista_b_id: t.omar.id,
  recipe_b_id: t.b.id,
  judge_ids: [t.sara.id, t.yousef.id],
  ...extra,
});

describe('judging criteria', () => {
  it('scores both cups before pointing, and shows scores only after the reveal', async () => {
    const t = await team();
    const duel = (await t.owner.post<DuelView>('/api/duels', { recipe_a_id: t.a.id, recipe_b_id: t.b.id, judge_ids: [t.sara.id, t.yousef.id] })).body;
    await t.owner.post(`/api/duels/${duel.id}/ready`);

    // A vote needs every criterion for both cups, in half steps.
    const url = `/api/duels/${duel.id}/vote`;
    expect((await t.sara.client.post(url, { choice: 'x' })).body.error.field).toBe('scores');
    const noBody = { ...vote('x'), scores: { ...judgeScores(), y: { ...judgeScores().y, body: undefined } } };
    expect((await t.sara.client.post(url, noBody)).body.error.field).toBe('scores.y.body');
    const oddStep = { ...vote('x'), scores: { ...judgeScores(), x: { ...judgeScores().x, overall: 7.3 } } };
    expect((await t.sara.client.post(url, oddStep)).body.error.field).toBe('scores.x.overall');

    const first = (await t.sara.client.post<DuelView>(url, vote('x', 8, 6.5))).body;
    // Before the reveal nobody sees any scores, their own included.
    expect(first.judges.every((j) => j.scores === null)).toBe(true);
    expect(first.result).toBeNull();
    const last = (await t.yousef.client.post<DuelView>(url, vote('y', 7, 7.5))).body;
    expect(last.status).toBe('revealed');
    expect(last.result).toEqual({ x_votes: 1, y_votes: 1, ties: 0, winner: null, scores: judgeScores(7.5, 7) });
    const sara = last.judges.find((j) => j.id === t.sara.id);
    expect(sara?.scores).toEqual(judgeScores(8, 6.5));
  });
});

describe('barista duels', () => {
  it('runs a barista duel: the host places the cups, the baristas brew, the judges score blind', async () => {
    const t = await team();
    const created = await t.owner.post<DuelView>('/api/duels', baristaDuel(t));
    expect(created.status).toBe(201);
    const host = created.body;
    expect(host).toMatchObject({ kind: 'baristas', status: 'pouring', you: { is_creator: true, is_barista: false } });
    // The host knows which barista's cup goes on X, and that barista's recipe is behind X.
    const linaIsX = host.x_barista?.id === t.lina.id;
    expect(host.x?.id).toBe(linaIsX ? t.a.id : t.b.id);
    expect(host.y_barista?.id).toBe(linaIsX ? t.omar.id : t.lina.id);

    // Lina knows she competes and what she brews, not which cup it becomes.
    const linaView = (await t.lina.client.get<DuelView>(`/api/duels/${host.id}`)).body;
    expect(linaView).toMatchObject({ x: null, y: null, x_barista: null, y_barista: null, you: { is_barista: true, is_judge: false } });
    expect(linaView.you.my_recipe?.id).toBe(t.a.id);
    expect(linaView.baristas?.map((p) => p.name)).toEqual(['Lina Haddad', 'Omar Saleh']);

    // Judges see who competes, but nothing about the cups.
    for (const judge of [t.sara, t.yousef]) {
      const text = JSON.stringify((await judge.client.get(`/api/duels/${host.id}`)).body) + JSON.stringify((await judge.client.get('/api/duels')).body);
      for (const secret of [t.a.id, t.b.id, t.a.display_code, t.b.display_code, t.a.name ?? '', t.b.name ?? '']) expect(text).not.toContain(secret);
      const view = (await judge.client.get<DuelView>(`/api/duels/${host.id}`)).body;
      expect(view).toMatchObject({ x_barista: null, y_barista: null, you: { is_judge: true, is_barista: false, my_recipe: null } });
    }
    const list = (await t.omar.client.get<DuelsResponse>('/api/duels')).body;
    expect(list.active[0]?.you).toMatchObject({ is_barista: true });

    // Both judges score Lina's cup higher and point at it.
    await t.owner.post(`/api/duels/${host.id}/ready`);
    const linaCup = linaIsX ? 'x' : 'y';
    const [sx, sy] = linaIsX ? [8, 6] : [6, 8];
    await t.sara.client.post(`/api/duels/${host.id}/vote`, vote(linaCup, sx, sy));
    const revealed = (await t.yousef.client.post<DuelView>(`/api/duels/${host.id}/vote`, vote(linaCup, sx, sy))).body;
    expect(revealed.status).toBe('revealed');
    expect(revealed.result?.winner).toBe(linaCup);
    const everyone = (await t.omar.client.get<DuelView>(`/api/duels/${host.id}`)).body;
    expect((linaCup === 'x' ? everyone.x_barista : everyone.y_barista)?.id).toBe(t.lina.id);

    // Baristas are ranked; recipe Elo is untouched by a barista duel.
    const standings = (await t.sara.client.get<BaristaStandingsResponse>('/api/duels/standings')).body.baristas;
    expect(standings.map((s) => [s.name, s.elo, s.wins, s.losses, s.avg_overall])).toEqual([
      ['Lina Haddad', 1516, 1, 0, 8],
      ['Omar Saleh', 1484, 0, 1, 6],
    ]);
    const recipes = (await t.owner.get<RecipesResponse>('/api/recipes')).body.recipes;
    for (const r of recipes) expect(r).toMatchObject({ elo: 1500, duels: 0 });

    // A rematch keeps the baristas, each with their own recipe, and the judges; a new coin flip
    // decides the cups.
    const rematch = (await t.owner.post<DuelView>(`/api/duels/${host.id}/rematch`)).body;
    const recipeOf = (view: DuelView, barista: string) => (view.x_barista?.id === barista ? view.x?.id : view.y?.id);
    expect([rematch.x_barista?.id, rematch.y_barista?.id].sort()).toEqual([t.lina.id, t.omar.id].sort());
    expect(recipeOf(rematch, t.lina.id)).toBe(t.a.id);
    expect(recipeOf(rematch, t.omar.id)).toBe(t.b.id);
    expect(rematch.judges.map((j) => j.id).sort()).toEqual([t.sara.id, t.yousef.id].sort());

    // Scores go into the backup with the finished duel.
    const scores = (await t.owner.get<ExportPage>('/api/export?part=duel_scores')).body.rows;
    expect(scores).toHaveLength(4);
  });

  it('checks the setup: two different baristas, judges who aren’t in it, and the same recipe is fine', async () => {
    const t = await team();
    const post = (extra: Record<string, unknown>) => t.owner.post('/api/duels', baristaDuel(t, extra));
    expect((await post({ barista_b_id: t.lina.id })).body.error.field).toBe('barista_b_id');
    expect((await post({ judge_ids: [t.lina.id] })).body.error.code).toBe('barista_cannot_judge');
    expect((await post({ barista_b_id: 'nobody-here' })).body.error.code).toBe('barista_not_found');
    expect((await post({ recipe_b_id: undefined })).body.error.field).toBe('recipe_b_id');
    expect((await post({ recipe_b_id: 'not-a-recipe' })).body.error.code).toBe('recipe_not_found');
    const me = (await t.owner.get<{ member: { id: string } }>('/api/me')).body.member.id;
    expect((await post({ judge_ids: [me] })).body.error.code).toBe('helper_cannot_judge');

    // Both brewing one recipe: all technique.
    const same = await post({ recipe_b_id: t.a.id });
    expect(same.status).toBe(201);
    // A barista can host their own duel; they see the cups, and still can't judge.
    const hosted = await t.lina.client.post<DuelView>('/api/duels', baristaDuel(t, { judge_ids: [t.sara.id] }));
    expect(hosted.status).toBe(201);
    expect(hosted.body.x_barista).not.toBeNull();
    expect(hosted.body.you).toMatchObject({ is_creator: true, is_barista: true });
  });

  it('counts on the Board as a duel on the competition coffee', async () => {
    const t = await team();
    const comp = (await t.owner.post<{ id: string }>('/api/beans', { name: 'Ethiopia Guji', is_competition_coffee: true })).body;
    const duel = (await t.owner.post<DuelView>('/api/duels', baristaDuel(t, { bean_id: comp.id }))).body;
    await t.owner.post(`/api/duels/${duel.id}/ready`);
    await t.sara.client.post(`/api/duels/${duel.id}/vote`, vote('x'));
    await t.yousef.client.post(`/api/duels/${duel.id}/vote`, vote('x'));
    const board = (await t.owner.get<BoardResponse>('/api/board')).body;
    expect(board.readiness.find((r) => r.key === 'comp_duel')).toMatchObject({ done: true, value: 1 });
  });

  it('draws and same-recipe duels never break the rankings', async () => {
    const t = await team();
    const duel = (await t.owner.post<DuelView>('/api/duels', baristaDuel(t, { recipe_b_id: t.a.id }))).body;
    await t.owner.post(`/api/duels/${duel.id}/ready`);
    await t.sara.client.post(`/api/duels/${duel.id}/vote`, vote('x'));
    const last = (await t.yousef.client.post<DuelView>(`/api/duels/${duel.id}/vote`, vote('y'))).body;
    expect(last.result?.winner).toBeNull();
    const standings = (await t.owner.get<BaristaStandingsResponse>('/api/duels/standings')).body.baristas;
    expect(standings.map((s) => [s.elo, s.draws])).toEqual([
      [1500, 1],
      [1500, 1],
    ]);
  });
});
