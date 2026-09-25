import { createContext, useContext } from 'react';
import { queryOptions, type QueryClient } from '@tanstack/react-query';
import type { MeResponse, MembersResponse, SetupStatus, SignInList } from '../../shared/types';
import { ApiError, api } from './api';

export const setupStatusQuery = queryOptions({
  queryKey: ['setup-status'],
  queryFn: () => api<SetupStatus>('GET', '/api/setup/status'),
  staleTime: Infinity,
});

/** The signed-in member, or null when signed out. */
export const meQuery = queryOptions({
  queryKey: ['me'],
  queryFn: async (): Promise<MeResponse | null> => {
    try {
      return await api<MeResponse>('GET', '/api/me');
    } catch (err) {
      if (err instanceof ApiError && err.code === 'not_signed_in') return null;
      throw err;
    }
  },
  staleTime: 5 * 60_000,
});

export const signInListQuery = queryOptions({
  queryKey: ['signin-list'],
  queryFn: () => api<SignInList>('GET', '/api/auth/members'),
});

export const membersQuery = queryOptions({
  queryKey: ['members'],
  queryFn: () => api<MembersResponse>('GET', '/api/members'),
});

/** Queries that work while signed out; everything else belongs to a session. */
const PUBLIC_QUERIES = new Set(['setup-status', 'me', 'signin-list']);

/**
 * After sign-out (or a "signed out" answer from the API): flip to the sign-in
 * screen first, then drop the signed-in data. Safe to call more than once.
 */
export function clearSessionData(qc: QueryClient): void {
  qc.setQueryData(meQuery.queryKey, null);
  qc.removeQueries({ predicate: (q) => !PUBLIC_QUERIES.has(String(q.queryKey[0])) });
}

const MeContext = createContext<MeResponse | null>(null);
export const MeProvider = MeContext.Provider;

/** Only valid inside the signed-in shell. */
export function useMe(): MeResponse {
  const me = useContext(MeContext);
  if (!me) throw new Error('useMe() used outside the signed-in shell');
  return me;
}

export function useIsOwner(): boolean {
  return useMe().member.role === 'owner';
}

const LAST_MEMBER_KEY = 'ap-last-member';

export function rememberMember(id: string): void {
  try {
    localStorage.setItem(LAST_MEMBER_KEY, id);
  } catch {
    // Convenience only.
  }
}

export function lastMember(): string | null {
  try {
    return localStorage.getItem(LAST_MEMBER_KEY);
  } catch {
    return null;
  }
}

export function forgetMember(): void {
  try {
    localStorage.removeItem(LAST_MEMBER_KEY);
  } catch {
    // Convenience only.
  }
}
