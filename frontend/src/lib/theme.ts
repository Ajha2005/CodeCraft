import { useSyncExternalStore } from 'react';
import { setMapMode } from '../features/map/world/theme';

// Light / dark theme. Dark is the default and is exactly the look the app has
// always had; light is a second skin on the same markup (see the
// `html[data-theme='light']` block in index.css). The choice is remembered on
// this device and applied before first paint by a tiny script in index.html,
// so there is never a flash of the wrong theme.

export type Theme = 'dark' | 'light';

const KEY = 'cc.theme.v1';
const EVENT = 'cc:theme';

function read(): Theme {
  try {
    return localStorage.getItem(KEY) === 'light' ? 'light' : 'dark';
  } catch {
    return 'dark';
  }
}

export function getTheme(): Theme {
  if (typeof document === 'undefined') return 'dark';
  return document.documentElement.dataset.theme === 'light' ? 'light' : 'dark';
}

/** Apply a theme to the page (and remember it). Safe to call before React mounts. */
export function applyTheme(theme: Theme, persist = true) {
  const root = document.documentElement;
  root.dataset.theme = theme;
  root.style.colorScheme = theme;
  setMapMode(theme);
  const meta = document.querySelector('meta[name="theme-color"]');
  if (meta) meta.setAttribute('content', theme === 'light' ? '#e8f1f9' : '#071019');
  if (persist) {
    try {
      localStorage.setItem(KEY, theme);
    } catch {
      // best-effort: the choice then lasts until the tab closes
    }
  }
  window.dispatchEvent(new Event(EVENT));
}

/** Called once at startup so the attribute is right even if index.html's script was blocked. */
export function initTheme() {
  applyTheme(read(), false);
}

function subscribe(fn: () => void) {
  window.addEventListener(EVENT, fn);
  return () => window.removeEventListener(EVENT, fn);
}

/** The current theme, plus a setter and a flip. Re-renders when the theme changes anywhere. */
export function useTheme() {
  const theme = useSyncExternalStore(subscribe, getTheme, () => 'dark' as Theme);
  return {
    theme,
    isLight: theme === 'light',
    setTheme: (t: Theme) => applyTheme(t),
    toggle: () => applyTheme(theme === 'light' ? 'dark' : 'light'),
  };
}
