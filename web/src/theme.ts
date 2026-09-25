// Light and dark follow the device unless the user picks one in Settings.
// public/theme-init.js applies the saved choice before first paint.

export type ThemePref = 'system' | 'light' | 'dark';

const KEY = 'ap-theme';
const BG = { light: '#E8ECEA', dark: '#0C1412' } as const;
const darkQuery = () => window.matchMedia('(prefers-color-scheme: dark)');

export function getThemePref(): ThemePref {
  try {
    const saved = localStorage.getItem(KEY);
    if (saved === 'light' || saved === 'dark') return saved;
  } catch {
    // Storage can be blocked (private mode); fall back to the device setting.
  }
  return 'system';
}

function effectiveTheme(pref: ThemePref): 'light' | 'dark' {
  if (pref !== 'system') return pref;
  return darkQuery().matches ? 'dark' : 'light';
}

export function applyTheme(pref: ThemePref): void {
  const root = document.documentElement;
  if (pref === 'system') delete root.dataset.theme;
  else root.dataset.theme = pref;
  document.querySelector('meta[name="theme-color"]')?.setAttribute('content', BG[effectiveTheme(pref)]);
}

export function setThemePref(pref: ThemePref): void {
  try {
    if (pref === 'system') localStorage.removeItem(KEY);
    else localStorage.setItem(KEY, pref);
  } catch {
    // Not saved, but still applied for this visit.
  }
  applyTheme(pref);
}

/** Keep the browser chrome colour in sync when the device switches light/dark. */
export function watchSystemTheme(): void {
  darkQuery().addEventListener('change', () => applyTheme(getThemePref()));
}
