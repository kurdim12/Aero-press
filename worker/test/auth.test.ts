import { env } from 'cloudflare:workers';
import { beforeEach, describe, expect, it } from 'vitest';
import { Client, OWNER_PIN, TEAM_PIN, addBarista, freshDb, setupTeam, signIn } from './helpers';

beforeEach(freshDb);

describe('first-run setup', () => {
  it('creates the team and owner once, then closes', async () => {
    const anon = new Client();
    expect((await anon.get('/api/setup/status')).body).toEqual({ needs_setup: true });

    const { owner, me } = await setupTeam();
    expect(me.member.role).toBe('owner');
    expect(me.member.initials).toBe('AK');
    expect(me.team.name).toBe('Kurdi Coffee Lab');
    expect((await owner.get('/api/me')).status).toBe(200);
    expect((await anon.get('/api/setup/status')).body).toEqual({ needs_setup: false });

    const again = await new Client().post('/api/setup', {
      team_name: 'Second team',
      owner_name: 'Someone',
      owner_pin: '9999',
      team_pin: '8888',
    });
    expect(again.status).toBe(409);
    expect(again.body.error.code).toBe('already_set_up');
  });

  it('rejects matching owner and team PINs and malformed PINs', async () => {
    const c = new Client();
    const same = await c.post('/api/setup', { team_name: 'T', owner_name: 'O', owner_pin: '1234', team_pin: '1234' });
    expect(same.status).toBe(400);
    expect(same.body.error.field).toBe('team_pin');

    const short = await c.post('/api/setup', { team_name: 'T', owner_name: 'O', owner_pin: '12', team_pin: '1234' });
    expect(short.status).toBe(400);
    expect(short.body.error.message).toMatch(/4 to 8 digits/);
    expect((await c.get('/api/setup/status')).body.needs_setup).toBe(true);
  });

  it('never stores PINs or session tokens in plain text', async () => {
    const { owner } = await setupTeam();
    const team = await env.DB.prepare('SELECT pin_hash, pin_salt FROM teams').first<{ pin_hash: string; pin_salt: string }>();
    const member = await env.DB.prepare('SELECT pin_hash, pin_salt FROM members').first<{ pin_hash: string; pin_salt: string }>();
    expect(team?.pin_hash).not.toContain(TEAM_PIN);
    expect(member?.pin_hash).not.toContain(OWNER_PIN);
    expect(team?.pin_salt).not.toBe(member?.pin_salt);

    const token = owner.cookie.split('=')[1] ?? '';
    const session = await env.DB.prepare('SELECT token_hash FROM sessions').first<{ token_hash: string }>();
    expect(token.length).toBeGreaterThan(40);
    expect(session?.token_hash).not.toBe(token);
  });
});

describe('sign-in', () => {
  it('sets an HttpOnly, Secure, SameSite=Lax cookie with a 30-day expiry', async () => {
    const { owner } = await setupTeam();
    const list = await owner.get('/api/auth/members');
    const ownerId = list.body.members[0].id;
    const { res } = await signIn(ownerId, OWNER_PIN);
    const cookie = res.headers.get('set-cookie') ?? '';
    expect(cookie).toMatch(/^ap_session=/);
    expect(cookie).toMatch(/HttpOnly/i);
    expect(cookie).toMatch(/Secure/i);
    expect(cookie).toMatch(/SameSite=Lax/i);
    const expires = Date.parse(/Expires=([^;]+)/i.exec(cookie)?.[1] ?? '');
    const days = (expires - Date.now()) / 86_400_000;
    expect(days).toBeGreaterThan(29.9);
    expect(days).toBeLessThanOrEqual(30);
  });

  it('lists active members with how each signs in', async () => {
    const { owner } = await setupTeam();
    await addBarista(owner, 'Lina Haddad');
    await addBarista(owner, 'Omar');
    const list = await new Client().get('/api/auth/members');
    expect(list.status).toBe(200);
    expect(list.body.team_name).toBe('Kurdi Coffee Lab');
    expect(list.body.members.map((m: { name: string; pin_type: string }) => [m.name, m.pin_type])).toEqual([
      ['Abdelrahman Kurdi', 'owner'],
      ['Lina Haddad', 'team'],
      ['Omar', 'team'],
    ]);
  });

  it('baristas use the team PIN; the owner uses only the owner PIN', async () => {
    const { owner, me } = await setupTeam();
    const linaId = await addBarista(owner, 'Lina Haddad');

    const lina = await signIn(linaId, TEAM_PIN);
    expect(lina.res.status).toBe(200);
    expect(lina.res.body.member).toMatchObject({ name: 'Lina Haddad', role: 'barista', initials: 'LH' });
    expect((await lina.client.get('/api/me')).body.member.role).toBe('barista');

    expect((await signIn(linaId, OWNER_PIN)).res.body.error.code).toBe('wrong_pin');
    const ownerWithTeamPin = await signIn(me.member.id, TEAM_PIN);
    expect(ownerWithTeamPin.res.status).toBe(401);
    expect(ownerWithTeamPin.res.body.error.code).toBe('wrong_pin');
    expect((await signIn(me.member.id, OWNER_PIN)).res.status).toBe(200);
  });

  it('locks a member for 15 minutes after 5 wrong PINs', async () => {
    const { owner } = await setupTeam();
    const omarId = await addBarista(owner, 'Omar');

    const triesLeft: number[] = [];
    for (let i = 0; i < 4; i++) {
      const { res } = await signIn(omarId, '0000');
      expect(res.status).toBe(401);
      triesLeft.push(res.body.error.tries_left);
    }
    expect(triesLeft).toEqual([4, 3, 2, 1]);

    const fifth = await signIn(omarId, '0000');
    expect(fifth.res.status).toBe(429);
    expect(fifth.res.body.error.code).toBe('locked');
    expect(fifth.res.body.error.message).toMatch(/15 more minutes/);

    // Even the right PIN is refused while locked.
    const locked = await signIn(omarId, TEAM_PIN);
    expect(locked.res.status).toBe(429);

    // Other members are unaffected.
    const linaId = await addBarista(owner, 'Lina');
    expect((await signIn(linaId, TEAM_PIN)).res.status).toBe(200);

    // After the lock expires the right PIN works and the counter resets.
    await env.DB.prepare('UPDATE login_attempts SET locked_until = ? WHERE member_id = ?').bind(Date.now() - 1, omarId).run();
    expect((await signIn(omarId, TEAM_PIN)).res.status).toBe(200);
    expect(await env.DB.prepare('SELECT * FROM login_attempts WHERE member_id = ?').bind(omarId).first()).toBeNull();
  });

  it('starts a fresh failure window after 15 minutes', async () => {
    const { owner } = await setupTeam();
    const omarId = await addBarista(owner, 'Omar');
    for (let i = 0; i < 4; i++) await signIn(omarId, '0000');
    await env.DB.prepare('UPDATE login_attempts SET first_failed_at = ? WHERE member_id = ?')
      .bind(Date.now() - 16 * 60 * 1000, omarId)
      .run();
    const next = await signIn(omarId, '0000');
    expect(next.res.status).toBe(401);
    expect(next.res.body.error.tries_left).toBe(4);
  });

  it('logout ends the session', async () => {
    const { owner } = await setupTeam();
    const stale = new Client();
    stale.cookie = owner.cookie;
    expect((await owner.post('/api/auth/logout')).status).toBe(200);
    const after = await stale.get('/api/me');
    expect(after.status).toBe(401);
    expect(after.body.error.code).toBe('not_signed_in');
  });

  it('expired sessions are refused', async () => {
    const { owner } = await setupTeam();
    await env.DB.prepare('UPDATE sessions SET expires_at = ?').bind(Date.now() - 1).run();
    expect((await owner.get('/api/me')).status).toBe(401);
  });
});

describe('roles and member management', () => {
  it('only the owner can manage members and PINs', async () => {
    const { owner, me } = await setupTeam();
    const linaId = await addBarista(owner, 'Lina');
    const { client: lina } = await signIn(linaId, TEAM_PIN);

    for (const res of [
      await lina.post('/api/members', { name: 'Sneaky' }),
      await lina.patch(`/api/members/${me.member.id}`, { active: false }),
      await lina.put(`/api/members/${linaId}/pin`, { pin: '5555' }),
      await lina.delete(`/api/members/${linaId}/pin`),
      await lina.put('/api/team/pin', { pin: '5555' }),
    ]) {
      expect(res.status).toBe(403);
      expect(res.body.error.code).toBe('owner_only');
    }

    // Baristas can see active teammates (to pick judges) but not sign-in details.
    const list = await lina.get('/api/members');
    expect(list.status).toBe(200);
    expect(list.body.members[0]).not.toHaveProperty('pin_type');
  });

  it('requires a session for member routes', async () => {
    await setupTeam();
    const res = await new Client().get('/api/members');
    expect(res.status).toBe(401);
    expect(res.body.error.code).toBe('not_signed_in');
  });

  it('rejects duplicate active names', async () => {
    const { owner } = await setupTeam();
    await addBarista(owner, 'Lina');
    const dup = await owner.post('/api/members', { name: 'lina' });
    expect(dup.status).toBe(409);
    expect(dup.body.error.code).toBe('name_taken');
  });

  it('deactivating a barista signs them out and hides them from sign-in', async () => {
    const { owner } = await setupTeam();
    const linaId = await addBarista(owner, 'Lina');
    const { client: lina } = await signIn(linaId, TEAM_PIN);

    expect((await owner.patch(`/api/members/${linaId}`, { active: false })).status).toBe(200);
    expect((await lina.get('/api/me')).status).toBe(401);
    const names = (await new Client().get('/api/auth/members')).body.members.map((m: { name: string }) => m.name);
    expect(names).not.toContain('Lina');
    expect((await signIn(linaId, TEAM_PIN)).res.status).toBe(404);

    const all = await owner.get('/api/members');
    expect(all.body.members.find((m: { id: string }) => m.id === linaId).active).toBe(false);

    expect((await owner.patch(`/api/members/${linaId}`, { active: true })).status).toBe(200);
    expect((await signIn(linaId, TEAM_PIN)).res.status).toBe(200);
  });

  it('the owner cannot be deactivated', async () => {
    const { owner, me } = await setupTeam();
    const res = await owner.patch(`/api/members/${me.member.id}`, { active: false });
    expect(res.status).toBe(400);
  });

  it('reset PIN gives a barista a personal PIN; clearing it restores the team PIN', async () => {
    const { owner } = await setupTeam();
    const linaId = await addBarista(owner, 'Lina');
    const { client: linaPhone } = await signIn(linaId, TEAM_PIN);

    expect((await owner.put(`/api/members/${linaId}/pin`, { pin: '4321' })).status).toBe(200);
    expect((await linaPhone.get('/api/me')).status).toBe(401); // signed out elsewhere
    expect((await signIn(linaId, TEAM_PIN)).res.status).toBe(401);
    expect((await signIn(linaId, '4321')).res.status).toBe(200);
    const listed = (await new Client().get('/api/auth/members')).body.members.find((m: { id: string }) => m.id === linaId);
    expect(listed.pin_type).toBe('personal');

    expect((await owner.delete(`/api/members/${linaId}/pin`)).status).toBe(200);
    expect((await signIn(linaId, '4321')).res.status).toBe(401);
    expect((await signIn(linaId, TEAM_PIN)).res.status).toBe(200);
  });

  it('reset PIN clears a lockout', async () => {
    const { owner } = await setupTeam();
    const omarId = await addBarista(owner, 'Omar');
    for (let i = 0; i < 5; i++) await signIn(omarId, '0000');
    expect((await signIn(omarId, TEAM_PIN)).res.status).toBe(429);
    expect((await owner.put(`/api/members/${omarId}/pin`, { pin: '7777' })).status).toBe(200);
    expect((await signIn(omarId, '7777')).res.status).toBe(200);
  });

  it('owner PIN reset keeps the current session and must differ from the team PIN', async () => {
    const { owner, me } = await setupTeam();
    const clash = await owner.put(`/api/members/${me.member.id}/pin`, { pin: TEAM_PIN });
    expect(clash.status).toBe(400);
    expect(clash.body.error.code).toBe('pin_matches_team');

    expect((await owner.put(`/api/members/${me.member.id}/pin`, { pin: '11223344' })).status).toBe(200);
    expect((await owner.get('/api/me')).status).toBe(200);
    expect((await signIn(me.member.id, OWNER_PIN)).res.status).toBe(401);
    expect((await signIn(me.member.id, '11223344')).res.status).toBe(200);
  });

  it('changing the team PIN switches baristas to the new PIN', async () => {
    const { owner } = await setupTeam();
    const linaId = await addBarista(owner, 'Lina');

    const clash = await owner.put('/api/team/pin', { pin: OWNER_PIN });
    expect(clash.status).toBe(400);
    expect(clash.body.error.code).toBe('pin_matches_owner');

    expect((await owner.put('/api/team/pin', { pin: '9753' })).status).toBe(200);
    expect((await signIn(linaId, TEAM_PIN)).res.status).toBe(401);
    expect((await signIn(linaId, '9753')).res.status).toBe(200);
  });

  it('refuses members from outside the team', async () => {
    const { owner } = await setupTeam();
    const res = await owner.put('/api/members/not-a-member/pin', { pin: '5555' });
    expect(res.status).toBe(404);
  });
});

describe('API hygiene', () => {
  it('requires JSON bodies', async () => {
    const res = await new Client().request('POST', '/api/auth/login');
    expect(res.status).toBe(415);
    expect(res.body.error.code).toBe('json_required');
  });

  it('returns JSON 404 for unknown API routes and no-store caching', async () => {
    const res = await new Client().get('/api/nope');
    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe('not_found');
    expect(res.headers.get('cache-control')).toBe('no-store');
  });
});
