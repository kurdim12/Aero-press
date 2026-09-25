// Display and input formatting for numbers, times, dates and records.
import { brewRatio } from '../../shared/formulas';
import { strings } from './strings';

/** 105 -> "1:45". */
export function formatSeconds(total: number | null | undefined): string {
  if (total == null) return '';
  const s = Math.max(0, Math.round(total));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

/**
 * Parse a time into seconds: "1:45", or "1.45" / "1,45" (phone number pads have no colon),
 * or plain seconds like "105" or "45s". Empty input is null; anything else is 'invalid'.
 */
export function parseTime(text: string): number | null | 'invalid' {
  const t = text.trim();
  if (!t) return null;
  const mmss = /^(\d{1,2})(?::(\d{1,2})|[.,](\d{2}))$/.exec(t);
  if (mmss) {
    const secs = Number(mmss[2] ?? mmss[3]);
    return secs < 60 ? Number(mmss[1]) * 60 + secs : 'invalid';
  }
  const plain = /^(\d{1,4})\s*s?$/i.exec(t);
  return plain ? Number(plain[1]) : 'invalid';
}

/** Parse "17.5" or "17,5" into a number. Empty input is null; anything else is 'invalid'. */
export function parseNumber(text: string): number | null | 'invalid' {
  const t = text.trim().replace(',', '.');
  if (!t) return null;
  const n = Number(t);
  return Number.isFinite(n) ? n : 'invalid';
}

/** Up to `digits` decimals without trailing zeros: 18 -> "18", 17.25 -> "17.25". */
export function formatNumber(value: number | null | undefined, digits = 2): string {
  if (value == null) return '';
  return String(Number(value.toFixed(digits)));
}

export function formatRatio(water: number | null | undefined, dose: number | null | undefined): string | null {
  const r = brewRatio(water, dose);
  return r === null ? null : `1:${r.toFixed(1)}`;
}

export const formatGrams = (g: number | null | undefined) => (g == null ? '' : `${formatNumber(g, 1)} ${strings.units.g}`);
export const formatTemp = (c: number | null | undefined) => (c == null ? '' : `${formatNumber(c, 1)}${strings.units.celsius}`);
export const formatPercent = (p: number | null | undefined, digits = 2) =>
  p == null ? '' : `${formatNumber(p, digits)}${strings.units.percent}`;

const dayMonth = new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'short' });
const dayMonthYear = new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });

/** "12 Sep", or "12 Sep 2025" outside the current year. */
export function formatDate(ms: number): string {
  const d = new Date(ms);
  return (d.getFullYear() === new Date().getFullYear() ? dayMonth : dayMonthYear).format(d);
}

export const formatRecord = strings.recipes.record;
