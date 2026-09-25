// Ranges the API accepts, kept free of zod so the web app can check them too. The brew log
// checks before saving, because a brew queued offline can't be fixed once the server refuses it.

export const BREW_LIMITS = {
  total_time_s: { min: 0, max: 1800 },
  tds_pct: { min: 0.1, max: 25 },
  beverage_g: { min: 1, max: 1000 },
} as const;
