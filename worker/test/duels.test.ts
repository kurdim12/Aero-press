import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { DuelView, DuelsResponse, RecipeRow, RecipesResponse } from '../../shared/types';
import { type Client, TEAM_PIN, addBarista, freshDb, judgeScores, recipeBody, setupTeam, signIn, vote } from './helpers';

beforeEach(freshDb);

/** Owner plus three barista judges, two recipes. The owner pours. */
async function duelTeam() {
  const { owner } = await setupTeam();
  const a = (await owner.post<RecipeRow>('/api/recipes', recipeBody({ name: 'Hotter bloom', temp_c: 94 }))).body;
  const b = (await owner.post<RecipeRow>('/api/recipes', recipeBody({ name: 'Cooler finish', temp_c: 86 }))).body;
  const judges: { id: string; client: Client }[] = [];
  for (const name of ['Lina Haddad', 'Omar Saleh', 'Sara Nasser']) {
    const id = await addBarista(owner, name);
    judges.push({ id, client: (await signIn(id, TEAM_PIN)).client });
  }
  const onlookerId = await addBarista(owner, 'Yousef Amin');
  const onlooker = (await signIn(onlookerId, TEAM_PIN)).client;
  return { owner, a, b, judges, onlooker };
}

async function startDuel(owner: Client, a: RecipeRow, b: RecipeRow, judgeIds: string[]) {
  const res = await owner.post<DuelView>('/api/duels', { recipe_a_id: a.id, recipe_b_id: b.id, judge_ids: judgeIds });
  expect(res.status).toBe(201);
  return res.body;
}

/**
 * Anything that would tell a judge which recipe is in which cup. (Not the bare code "R1": a random
 * id can contain it by chance.)
 */
const identities = (...recipes: RecipeRow[]) => recipes.flatMap((r) => [r.id, r.display_code, r.name ?? '']);

describe('blind duels', () => {
  it('runs setup → pouring → judging → reveal, and the reveal reaches every phone', async () => {
    const { owner, a, b, judges } = await duelTeam();
    const duel = await startDuel(owner, a, b, judges.map((j) => j.id));
    expect(duel).toMatchObject({ status: 'pouring', votes_in: 0, you: { is_creator: true, is_judge: false } });
    // The helper sees which recipe goes in which cup; the server picked the order.
    expect([duel.x?.id, duel.y?.id].sort()).toEqual([a.id, b.id].sort());

    const early = await judges[0]!.client.post(`/api/duels/${duel.id}/vote`, vote('x'));
    expect(early.status).toBe(409);
    expect(early.body.error.code).toBe('cups_not_ready');

    expect((await owner.post<DuelView>(`/api/duels/${duel.id}/ready`)).body.status).toBe('judging');
    await judges[0]!.client.post(`/api/duels/${duel.id}/vote`, vote('x'));
    const second = await judges[1]!.client.post<DuelView>(`/api/duels/${duel.id}/vote`, vote('x'));
    expect(second.body).toMatchObject({ status: 'judging', votes_in: 2, you: { vote: 'x' } });
    const last = await judges[2]!.client.post<DuelView>(`/api/duels/${duel.id}/vote`, vote('y'));
    expect(last.body.status).toBe('revealed');

    for (const phone of [owner, ...judges.map((j) => j.client)]) {
      const view = (await phone.get<DuelView>(`/api/duels/${duel.id}`)).body;
      expect(view.status).toBe('revealed');
      expect(view.result).toEqual({ x_votes: 2, y_votes: 1, ties: 0, winner: 'x', scores: judgeScores(7, 6) });
      expect(view.x?.id).toBe(duel.x?.id);
      expect(view.judges.map((j) => j.choice).sort()).toEqual(['x', 'x', 'y']);
    }

    // Elo moves on read.
    const ranked = (await owner.get<RecipesResponse>('/api/recipes')).body.recipes;
    const winner = ranked.find((r) => r.id === duel.x?.id);
    const loser = ranked.find((r) => r.id === duel.y?.id);
    expect(winner).toMatchObject({ elo: 1516, wins: 1, duels: 1 });
    expect(loser).toMatchObject({ elo: 1484, losses: 1 });
  });

  it('never sends judges or onlookers the recipes behind X and Y before the reveal', async () => {
    const { owner, a, b, judges, onlooker } = await duelTeam();
    const duel = (
      await owner.post<DuelView>('/api/duels', {
        recipe_a_id: a.id,
        recipe_b_id: b.id,
        judge_ids: judges.map((j) => j.id),
        notes: `${a.name} vs ${b.name}`,
      })
    ).body;
    const secrets = identities(a, b);
    const blind = async (phone: Client) => {
      const texts = [
        JSON.stringify((await phone.get(`/api/duels/${duel.id}`)).body),
        JSON.stringify((await phone.get('/api/duels')).body),
      ];
      for (const text of texts) for (const secret of secrets) expect(text).not.toContain(secret);
    };

    for (const phone of [...judges.map((j) => j.client), onlooker]) await blind(phone);
    await owner.post(`/api/duels/${duel.id}/ready`);
    for (const phone of [...judges.map((j) => j.client), onlooker]) await blind(phone);

    // The vote responses themselves stay blind until the last vote.
    for (const judge of judges.slice(0, 2)) {
      const text = JSON.stringify((await judge.client.post(`/api/duels/${duel.id}/vote`, vote('y'))).body);
      for (const secret of secrets) expect(text).not.toContain(secret);
      await blind(judge.client);
    }
    await blind(onlooker);

    // After the reveal everyone sees everything, notes included.
    const revealed = (await judges[2]!.client.post<DuelView>(`/api/duels/${duel.id}/vote`, vote('x'))).body;
    expect(revealed.status).toBe('revealed');
    const view = (await onlooker.get<DuelView>(`/api/duels/${duel.id}`)).body;
    expect([view.x?.display_code, view.y?.display_code].sort()).toEqual([a.display_code, b.display_code].sort());
    expect(view.notes).toBe(`${a.name} vs ${b.name}`);
  });

  it('counts "can’t separate" as no vote, and an even split is a draw', async () => {
    const { owner, a, b, judges } = await duelTeam();
    const duel = await startDuel(owner, a, b, [judges[0]!.id, judges[1]!.id, judges[2]!.id]);
    await owner.post(`/api/duels/${duel.id}/ready`);
    await judges[0]!.client.post(`/api/duels/${duel.id}/vote`, vote('x'));
    await judges[1]!.client.post(`/api/duels/${duel.id}/vote`, vote('y'));
    const last = (await judges[2]!.client.post<DuelView>(`/api/duels/${duel.id}/vote`, vote('tie'))).body;
    expect(last.result).toEqual({ x_votes: 1, y_votes: 1, ties: 1, winner: null, scores: judgeScores(7, 6) });
    const ranked = (await owner.get<RecipesResponse>('/api/recipes')).body.recipes;
    expect(ranked.find((r) => r.id === a.id)).toMatchObject({ elo: 1500, draws: 1 });
  });

  it('keeps each judge to one vote and only lets the picked judges vote', async () => {
    const { owner, a, b, judges, onlooker } = await duelTeam();
    const duel = await startDuel(owner, a, b, [judges[0]!.id, judges[1]!.id]);
    await owner.post(`/api/duels/${duel.id}/ready`);
    expect((await judges[0]!.client.post(`/api/duels/${duel.id}/vote`, vote('x'))).status).toBe(200);
    expect((await judges[0]!.client.post(`/api/duels/${duel.id}/vote`, vote('x'))).status).toBe(200);
    const changed = await judges[0]!.client.post(`/api/duels/${duel.id}/vote`, vote('y'));
    expect(changed.status).toBe(409);
    expect(changed.body.error.code).toBe('already_voted');
    expect((await onlooker.post(`/api/duels/${duel.id}/vote`, vote('x'))).body.error.code).toBe('not_a_judge');
    expect((await owner.post(`/api/duels/${duel.id}/vote`, vote('x'))).body.error.code).toBe('not_a_judge');
    expect((await judges[1]!.client.post(`/api/duels/${duel.id}/vote`, { ...vote('x'), choice: 'maybe' })).body.error.field).toBe('choice');
  });

  it('checks the setup: two recipes, 1 to 3 judges, and the helper can’t judge', async () => {
    const { owner, a, b, judges } = await duelTeam();
    const post = (body: Record<string, unknown>) =>
      owner.post('/api/duels', { recipe_a_id: a.id, recipe_b_id: b.id, judge_ids: [judges[0]!.id], ...body });
    expect((await post({ recipe_b_id: a.id })).body.error.field).toBe('recipe_b_id');
    expect((await post({ judge_ids: [] })).body.error.field).toBe('judge_ids');
    const fourId = await addBarista(owner, 'Fourth Judge');
    expect((await post({ judge_ids: [...judges.map((j) => j.id), fourId] })).body.error.field).toBe('judge_ids');
    const me = (await owner.get<{ member: { id: string } }>('/api/me')).body.member.id;
    expect((await post({ judge_ids: [me] })).body.error.code).toBe('helper_cannot_judge');
    expect((await post({ judge_ids: ['nobody-here'] })).body.error.code).toBe('judge_not_found');
    expect((await post({ recipe_a_id: 'not-a-recipe' })).body.error.code).toBe('recipe_not_found');
    expect((await post({ bean_id: 'not-a-bean' })).body.error.code).toBe('bean_not_found');
    // A barista can start a duel too, and pours it.
    const lina = judges[0]!.client;
    const theirs = await lina.post<DuelView>('/api/duels', { recipe_a_id: a.id, recipe_b_id: b.id, judge_ids: [judges[1]!.id] });
    expect(theirs.status).toBe(201);
    expect(theirs.body.x).not.toBeNull();
  });

  it('lets the helper reveal early with the votes in, and cancel', async () => {
    const { owner, a, b, judges } = await duelTeam();
    const duel = await startDuel(owner, a, b, judges.map((j) => j.id));
    expect((await owner.post(`/api/duels/${duel.id}/reveal`)).body.error.code).toBe('not_judging');
    await owner.post(`/api/duels/${duel.id}/ready`);
    expect((await owner.post(`/api/duels/${duel.id}/reveal`)).body.error.code).toBe('no_votes');
    await judges[0]!.client.post(`/api/duels/${duel.id}/vote`, vote('y'));
    expect((await judges[1]!.client.post(`/api/duels/${duel.id}/reveal`)).body.error.code).toBe('not_duel_helper');
    const early = (await owner.post<DuelView>(`/api/duels/${duel.id}/reveal`)).body;
    expect(early.result).toEqual({ x_votes: 0, y_votes: 1, ties: 0, winner: 'y', scores: judgeScores(7, 6) });
    const late = await judges[1]!.client.post(`/api/duels/${duel.id}/vote`, vote('x'));
    expect(late.body.error.code).toBe('duel_over');

    const other = await startDuel(owner, a, b, [judges[0]!.id]);
    const cancelled = (await owner.post<DuelView>(`/api/duels/${other.id}/cancel`)).body;
    expect(cancelled.status).toBe('cancelled');
    const judgeView = (await judges[0]!.client.get<DuelView>(`/api/duels/${other.id}`)).body;
    expect(judgeView.x).toBeNull();
    const list = (await owner.get<DuelsResponse>('/api/duels')).body;
    expect(list.active).toEqual([]);
    expect(list.recent.map((d) => d.status)).toEqual(['cancelled', 'revealed']);
  });

  it('rematches once with a fresh coin flip for the cups, and every phone can follow it', async () => {
    const { owner, a, b, judges } = await duelTeam();
    const duel = await startDuel(owner, a, b, [judges[0]!.id, judges[1]!.id]);
    expect((await owner.post(`/api/duels/${duel.id}/rematch`)).body.error.code).toBe('not_revealed');
    await owner.post(`/api/duels/${duel.id}/ready`);
    await judges[0]!.client.post(`/api/duels/${duel.id}/vote`, vote('x'));
    await judges[1]!.client.post(`/api/duels/${duel.id}/vote`, vote('x'));

    const rematch = await owner.post<DuelView>(`/api/duels/${duel.id}/rematch`);
    expect(rematch.status).toBe(201);
    expect(rematch.body).toMatchObject({ status: 'pouring', rematch_of: duel.id });
    expect([rematch.body.x?.id, rematch.body.y?.id].sort()).toEqual([duel.x?.id, duel.y?.id].sort());
    expect(rematch.body.judges.map((j) => j.id).sort()).toEqual([judges[0]!.id, judges[1]!.id].sort());

    const again = await owner.post<DuelView>(`/api/duels/${duel.id}/rematch`);
    expect(again.body.id).toBe(rematch.body.id);
    const judgeView = (await judges[0]!.client.get<DuelView>(`/api/duels/${duel.id}`)).body;
    expect(judgeView.rematch_id).toBe(rematch.body.id);
    expect((await judges[0]!.client.get<DuelView>(`/api/duels/${rematch.body.id}`)).body.x).toBeNull();
    // Before its reveal, judges aren't told it's a rematch.
    expect((await judges[0]!.client.get<DuelView>(`/api/duels/${rematch.body.id}`)).body.rematch_of).toBeNull();
  });

  describe('the coin', () => {
    // The coin flip reads one random byte (IDs and tokens read more, and stay random): force it.
    let coin = 1;
    beforeEach(() => {
      const real = crypto.getRandomValues.bind(crypto);
      vi.spyOn(crypto, 'getRandomValues').mockImplementation(<T extends ArrayBufferView | null>(array: T): T => {
        if (array instanceof Uint8Array && array.length === 1) {
          array[0] = coin;
          return array;
        }
        return real(array);
      });
    });
    afterEach(() => vi.restoreAllMocks());

    it('decides a rematch afresh: the cups can stay or swap, so the last reveal gives nothing away', async () => {
      const { owner, a, b, judges } = await duelTeam();
      const revealed = async () => {
        const duel = await startDuel(owner, a, b, [judges[0]!.id]);
        await owner.post(`/api/duels/${duel.id}/ready`);
        await judges[0]!.client.post(`/api/duels/${duel.id}/vote`, vote('x'));
        return duel;
      };
      coin = 1; // heads: recipe A is X, and a rematch keeps the cups
      const first = await revealed();
      expect(first.x?.id).toBe(a.id);
      const kept = (await owner.post<DuelView>(`/api/duels/${first.id}/rematch`)).body;
      expect([kept.x?.id, kept.y?.id]).toEqual([a.id, b.id]);

      const second = await revealed();
      coin = 0; // tails: the rematch swaps them
      const swapped = (await owner.post<DuelView>(`/api/duels/${second.id}/rematch`)).body;
      expect([swapped.x?.id, swapped.y?.id]).toEqual([b.id, a.id]);
    });
  });
});
