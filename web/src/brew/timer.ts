// The brew timer. Time comes from timestamps, not tick counts, so it stays right when the
// phone throttles the page; the state is saved so a reload or a tab switch doesn't lose a
// brew. It ticks app-wide, so step beeps sound even while another tab is open.
import { useEffect, useState, useSyncExternalStore } from 'react';
import { type BrewPlan, WINDOW_S, phaseIndexAt } from '../../../shared/phases';
import { browserStore, readJson, writeJson } from '../offline/storage';
import { beep, unlockAudio } from './sound';
import { holdScreenOn, releaseScreen } from './wakeLock';

export type TimerStatus = 'idle' | 'running' | 'paused';

export interface TimerState {
  recipeId: string | null;
  plan: BrewPlan | null;
  status: TimerStatus;
  /** Epoch ms of Start. */
  startedAt: number | null;
  /** Epoch ms of the current pause. */
  pausedAt: number | null;
  /** Total time spent paused, in ms. */
  pausedMs: number;
  /** Highest step index already announced with a beep. */
  announced: number;
}

const KEY = 'ap-brew-timer-v1';
const store = browserStore();
const IDLE: TimerState = { recipeId: null, plan: null, status: 'idle', startedAt: null, pausedAt: null, pausedMs: 0, announced: 0 };

/** A brew left running stops itself this long after its planned end (or 5:00, if later). */
const AUTO_STOP_AFTER_S = 120;
/** A timer started longer ago than this was forgotten, not paused for later. */
const STALE_AFTER_MS = 60 * 60_000;

let state: TimerState = { ...IDLE, ...(readJson<Partial<TimerState>>(store, KEY) ?? {}) };
if (state.startedAt !== null && Date.now() - state.startedAt > STALE_AFTER_MS) {
  state = IDLE;
  writeJson(store, KEY, null);
}
const listeners = new Set<() => void>();
let ticker: number | null = null;

export function elapsedMs(s: TimerState = state, now: number = Date.now()): number {
  if (s.startedAt === null) return 0;
  const end = s.status === 'paused' && s.pausedAt !== null ? s.pausedAt : now;
  return Math.max(0, end - s.startedAt - s.pausedMs);
}

function commit(next: TimerState): void {
  state = next;
  writeJson(store, KEY, next.status === 'idle' ? null : next);
  for (const listener of listeners) listener();
  applySideEffects();
}

function tick(): void {
  if (state.status !== 'running' || !state.plan || state.startedAt === null) return;
  const stopAtS = Math.max(state.plan.total, WINDOW_S) + AUTO_STOP_AFTER_S;
  if (elapsedMs() / 1000 >= stopAtS) {
    // Forgotten after the brew: freeze the clock at the stop time and let the screen sleep.
    // No beep, even if the app was closed through the last steps.
    const pausedAt = state.startedAt + state.pausedMs + stopAtS * 1000;
    commit({ ...state, status: 'paused', pausedAt, announced: state.plan.phases.length });
    return;
  }
  const index = phaseIndexAt(state.plan, elapsedMs() / 1000);
  if (index > state.announced) {
    // "Done" only when the plan covers the whole brew; an incomplete recipe just steps on.
    const finished = index >= state.plan.phases.length && state.plan.missing.length === 0;
    beep(finished ? 'done' : 'step');
    commit({ ...state, announced: index });
  }
}

function applySideEffects(): void {
  if (state.status === 'running') {
    ticker ??= window.setInterval(tick, 200);
    void holdScreenOn();
  } else {
    if (ticker !== null) window.clearInterval(ticker);
    ticker = null;
    void releaseScreen();
  }
}

/** Start from 0:00 (call from the Start tap so sound unlocks). */
export function startBrew(recipeId: string, plan: BrewPlan): void {
  unlockAudio();
  commit({ ...IDLE, recipeId, plan, status: 'running', startedAt: Date.now() });
}

export function pauseBrew(): void {
  if (state.status === 'running') commit({ ...state, status: 'paused', pausedAt: Date.now() });
}

export function resumeBrew(): void {
  if (state.status !== 'paused' || state.pausedAt === null) return;
  unlockAudio();
  commit({ ...state, status: 'running', pausedMs: state.pausedMs + (Date.now() - state.pausedAt), pausedAt: null });
}

export function resetBrew(): void {
  commit(IDLE);
}

export function getTimer(): TimerState {
  return state;
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function useTimer(): TimerState {
  return useSyncExternalStore(subscribe, getTimer);
}

/** The current time, refreshed several times a second while `active`, for a live clock. */
export function useNow(active: boolean, everyMs = 200): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!active) return;
    setNow(Date.now());
    const id = window.setInterval(() => setNow(Date.now()), everyMs);
    return () => window.clearInterval(id);
  }, [active, everyMs]);
  return now;
}

// A brew that was running before a reload keeps running.
if (typeof window !== 'undefined') applySideEffects();
