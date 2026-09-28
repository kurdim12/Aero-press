// A judge's unsent score sheet, kept on the phone so a reload doesn't lose it. It is keyed by
// member: on a shared café phone the next judge must never see (or send) someone else's scores.
import type { CupScores } from '../../shared/types';
import { browserStore, readJson, writeJson } from './offline/storage';

export type Sheet = Record<'x' | 'y', Partial<CupScores>>;

const PREFIX = 'ap-judge-sheet:';
const store = browserStore();
const keyOf = (memberId: string, duelId: string) => `${PREFIX}${memberId}:${duelId}`;

export const readSheet = (memberId: string, duelId: string): Sheet | null => readJson<Sheet>(store, keyOf(memberId, duelId));

/** Save the sheet as it stands, or drop it (null) once the vote is in. */
export const saveSheet = (memberId: string, duelId: string, sheet: Sheet | null): void => {
  writeJson(store, keyOf(memberId, duelId), sheet);
};

/** At sign-out: every sheet on this phone goes, including any an older version kept per duel. */
export function forgetJudgeSheets(): void {
  try {
    const ls = globalThis.localStorage;
    const keys: string[] = [];
    for (let i = 0; i < ls.length; i++) {
      const key = ls.key(i);
      if (key?.startsWith(PREFIX)) keys.push(key);
    }
    for (const key of keys) ls.removeItem(key);
  } catch {
    // Storage is blocked: the sheets only lived in memory, keyed by member.
  }
}
