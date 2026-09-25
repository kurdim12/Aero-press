import { beforeEach, describe, expect, it } from 'vitest';
import type { BeanRow, BeansResponse } from '../../shared/types';
import { Client, TEAM_PIN, addBarista, freshDb, setupTeam, signIn } from './helpers';

beforeEach(freshDb);

const bean = (overrides: Record<string, unknown> = {}) => ({
  name: 'Ethiopia Guji',
  roaster: 'Rift Roasters',
  origin: 'Ethiopia',
  process: 'Washed',
  roast_date: '2026-09-02',
  ...overrides,
});

async function teamWithBarista() {
  const { owner } = await setupTeam();
  const linaId = await addBarista(owner, 'Lina Haddad');
  const { client: lina } = await signIn(linaId, TEAM_PIN);
  return { owner, lina };
}

describe('beans', () => {
  it('any member adds and edits shared beans', async () => {
    const { owner, lina } = await teamWithBarista();
    const created = await lina.post<BeanRow>('/api/beans', bean({ variety: '  ' }));
    expect(created.status).toBe(201);
    expect(created.body).toMatchObject({ name: 'Ethiopia Guji', variety: null, brew_count: 0, is_competition_coffee: false });

    const list = await owner.get<BeansResponse>('/api/beans');
    expect(list.body.beans.map((b) => b.name)).toEqual(['Ethiopia Guji']);

    const edited = await owner.put<BeanRow>(`/api/beans/${created.body.id}`, bean({ name: 'Ethiopia Guji Hambela', notes: 'Peach' }));
    expect(edited.status).toBe(200);
    expect(edited.body).toMatchObject({ name: 'Ethiopia Guji Hambela', notes: 'Peach' });
  });

  it('validates names and roast dates', async () => {
    const { owner } = await setupTeam();
    const noName = await owner.post('/api/beans', bean({ name: ' ' }));
    expect(noName.status).toBe(400);
    expect(noName.body.error.field).toBe('name');

    const badFormat = await owner.post('/api/beans', bean({ roast_date: '02/09/2026' }));
    expect(badFormat.body.error).toMatchObject({ field: 'roast_date', message: 'Use a date like 2026-09-01.' });

    const noSuchDay = await owner.post('/api/beans', bean({ roast_date: '2026-02-31' }));
    expect(noSuchDay.status).toBe(400);
    expect(noSuchDay.body.error.field).toBe('roast_date');

    const blankDate = await owner.post<BeanRow>('/api/beans', bean({ roast_date: '' }));
    expect(blankDate.body.roast_date).toBeNull();
  });

  it('only the owner picks the competition coffee, and only one bean holds it', async () => {
    const { owner, lina } = await teamWithBarista();
    expect((await lina.post('/api/beans', bean({ is_competition_coffee: true }))).status).toBe(403);

    const guji = (await owner.post<BeanRow>('/api/beans', bean({ is_competition_coffee: true }))).body;
    const kenya = (await lina.post<BeanRow>('/api/beans', bean({ name: 'Kenya AA' }))).body;

    // A barista can edit the competition bean without touching the marker…
    const kept = await lina.put<BeanRow>(`/api/beans/${guji.id}`, bean({ notes: 'Tasting well' }));
    expect(kept.body.is_competition_coffee).toBe(true);
    // …but can't move it.
    expect((await lina.put(`/api/beans/${kenya.id}`, bean({ name: 'Kenya AA', is_competition_coffee: true }))).status).toBe(403);

    await owner.put(`/api/beans/${kenya.id}`, bean({ name: 'Kenya AA', is_competition_coffee: true }));
    const list = (await owner.get<BeansResponse>('/api/beans')).body.beans;
    expect(list.filter((b) => b.is_competition_coffee).map((b) => b.name)).toEqual(['Kenya AA']);
    expect(list[0]?.name).toBe('Kenya AA'); // competition coffee first
  });

  it('keeps beans inside the team and requires a session', async () => {
    const { owner } = await setupTeam();
    expect((await owner.put('/api/beans/nope', bean())).status).toBe(404);
    expect((await new Client().get('/api/beans')).status).toBe(401);
  });
});
