import { describe, expect, it } from 'vitest';
import { forgetJudgeSheets, readSheet, saveSheet } from '../../web/src/judgeSheet';

describe('judge score sheets on a shared phone', () => {
  it('keeps each judge’s unsent scores to themselves', () => {
    saveSheet('judge-a', 'duel-1', { x: { sweetness: 8 }, y: { sweetness: 6 } });
    expect(readSheet('judge-b', 'duel-1')).toBeNull();
    expect(readSheet('judge-a', 'duel-1')).toEqual({ x: { sweetness: 8 }, y: { sweetness: 6 } });
    saveSheet('judge-a', 'duel-1', null);
    expect(readSheet('judge-a', 'duel-1')).toBeNull();
    // Without browser storage there is nothing to clear, and it doesn't throw.
    expect(() => forgetJudgeSheets()).not.toThrow();
  });
});
