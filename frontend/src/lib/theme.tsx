'use client';

import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';

export const DEFAULT_THEME_COLOR = '#f97316';
const COLOR_KEY = 'pms_theme_color';

interface ThemeContextValue {
  isDark: boolean;
  toggleTheme: () => void;
  themeColor: string;
  getThemeColor: () => string;
  setThemeColor: (hex: string) => void;
}

const ThemeContext = createContext<ThemeContextValue | null>(null);

/** Mix a hex color towards white (amount > 0) or black (amount < 0). */
function shade(hex: string, amount: number): string {
  const n = parseInt(hex.slice(1), 16);
  const channels = [(n >> 16) & 255, (n >> 8) & 255, n & 255].map((c) =>
    Math.round(amount >= 0 ? c + (255 - c) * amount : c * (1 + amount)),
  );
  return `#${channels.map((c) => c.toString(16).padStart(2, '0')).join('')}`;
}

function applyColor(hex: string) {
  const root = document.documentElement.style;
  root.setProperty('--theme-primary', hex);
  root.setProperty('--theme-primary-light', shade(hex, 0.2));
  root.setProperty('--theme-primary-dark', shade(hex, -0.12));
}

/**
 * Script injected into <head> so the correct theme is applied before first paint
 * (Nexora rule: no flash of the wrong theme).
 */
export const themeInitScript = `(function(){try{var t=localStorage.getItem('theme');var d=t?t==='dark':window.matchMedia('(prefers-color-scheme: dark)').matches;if(d)document.documentElement.classList.add('dark');var c=localStorage.getItem('${COLOR_KEY}');if(c&&/^#[0-9a-fA-F]{6}$/.test(c))document.documentElement.style.setProperty('--theme-primary',c);}catch(e){}})();`;

export function ThemeProvider({ children }: { children: ReactNode }) {
  const [isDark, setIsDark] = useState(false);
  const [themeColor, setColor] = useState(DEFAULT_THEME_COLOR);

  useEffect(() => {
    setIsDark(document.documentElement.classList.contains('dark'));
    try {
      const saved = localStorage.getItem(COLOR_KEY);
      if (saved && /^#[0-9a-fA-F]{6}$/.test(saved)) {
        setColor(saved);
        applyColor(saved);
      }
    } catch {
      /* ignore */
    }
  }, []);

  const toggleTheme = useCallback(() => {
    setIsDark((prev) => {
      const next = !prev;
      document.documentElement.classList.toggle('dark', next);
      try {
        localStorage.setItem('theme', next ? 'dark' : 'light');
      } catch {
        /* ignore */
      }
      return next;
    });
  }, []);

  const setThemeColor = useCallback((hex: string) => {
    if (!/^#[0-9a-fA-F]{6}$/.test(hex)) return;
    setColor(hex);
    applyColor(hex);
    try {
      localStorage.setItem(COLOR_KEY, hex);
    } catch {
      /* ignore */
    }
  }, []);

  const value = useMemo(
    () => ({ isDark, toggleTheme, themeColor, getThemeColor: () => themeColor, setThemeColor }),
    [isDark, toggleTheme, themeColor, setThemeColor],
  );
  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}

export function useTheme() {
  const ctx = useContext(ThemeContext);
  if (!ctx) throw new Error('useTheme must be used inside ThemeProvider');
  return ctx;
}
