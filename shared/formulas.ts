// Brew formulas. The server computes stored values with these; the web app
// uses the same functions for live previews.

const round = (value: number, places: number) => {
  const f = 10 ** places;
  return Math.round(value * f) / f;
};

const present = (v: number | null | undefined): v is number => typeof v === 'number' && Number.isFinite(v);

/** Brew ratio: grams of water per gram of coffee (15 means 1:15). Null unless both exist and dose > 0. */
export function brewRatio(waterG: number | null | undefined, doseG: number | null | undefined): number | null {
  if (!present(waterG) || !present(doseG) || doseG <= 0 || waterG < 0) return null;
  return waterG / doseG;
}

/**
 * Extraction yield % = TDS % × beverage weight (g) ÷ dose (g), rounded to 2 places.
 * Only when all three exist; null otherwise.
 */
export function extractionYield(
  tdsPct: number | null | undefined,
  beverageG: number | null | undefined,
  doseG: number | null | undefined,
): number | null {
  if (!present(tdsPct) || !present(beverageG) || !present(doseG)) return null;
  if (doseG <= 0 || tdsPct < 0 || beverageG < 0) return null;
  return round((tdsPct * beverageG) / doseG, 2);
}

/** Whole days between a roast date (YYYY-MM-DD) and today's local date. Null for a missing or bad date. */
export function daysOffRoast(roastDate: string | null | undefined, today: Date = new Date()): number | null {
  if (!roastDate) return null;
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(roastDate);
  if (!m) return null;
  const roasted = Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  const now = Date.UTC(today.getFullYear(), today.getMonth(), today.getDate());
  if (Number.isNaN(roasted)) return null;
  return Math.round((now - roasted) / 86_400_000);
}
