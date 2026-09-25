import { describe, expect, it } from 'vitest';
import { initialsOf } from '../../shared/initials';
import { loginInput, setupInput } from '../../shared/schemas';

describe('initialsOf', () => {
  it('uses first and last word', () => {
    expect(initialsOf('Abdelrahman Kurdi')).toBe('AK');
    expect(initialsOf('lina al haddad')).toBe('LH');
  });

  it('uses two letters for one-word names', () => {
    expect(initialsOf('Omar')).toBe('OM');
  });

  it('copes with extra spaces, empty input and non-Latin names', () => {
    expect(initialsOf('  Sara   Nasser ')).toBe('SN');
    expect(initialsOf('')).toBe('?');
    expect(initialsOf('عبد الرحمن')).toBe('عا');
  });
});

describe('setup input', () => {
  const valid = { team_name: 'Lab', owner_name: 'Abdelrahman', owner_pin: '246810', team_pin: '1357' };

  it('accepts 4 to 8 digit PINs and trims names', () => {
    const parsed = setupInput.parse({ ...valid, team_name: '  Lab  ' });
    expect(parsed.team_name).toBe('Lab');
    expect(setupInput.safeParse({ ...valid, owner_pin: '12345678' }).success).toBe(true);
  });

  it('rejects short, long and non-numeric PINs', () => {
    for (const pin of ['123', '123456789', '12a4', ' 1234']) {
      expect(setupInput.safeParse({ ...valid, owner_pin: pin }).success).toBe(false);
    }
  });

  it('rejects the same PIN for owner and team', () => {
    const result = setupInput.safeParse({ ...valid, team_pin: valid.owner_pin });
    expect(result.success).toBe(false);
    expect(result.error?.issues[0]?.path).toEqual(['team_pin']);
  });

  it('login accepts digits only', () => {
    expect(loginInput.safeParse({ member_id: 'abc', pin: '1234' }).success).toBe(true);
    expect(loginInput.safeParse({ member_id: 'abc', pin: '12 34' }).success).toBe(false);
  });
});
