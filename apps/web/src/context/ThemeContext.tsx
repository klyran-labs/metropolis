import React, {
  createContext,
  useContext,
  useState,
  useEffect,
  useCallback,
  useMemo,
} from 'react';
import { flushSync } from 'react-dom';

export type Theme = 'light' | 'dark';

export interface ThemeContextValue {
  theme: Theme;
  toggleTheme: (event?: React.MouseEvent | { clientX: number; clientY: number }) => void;
  isDark: boolean;
}

const ThemeContext = createContext<ThemeContextValue | null>(null);

const STORAGE_KEY = 'AGENTGUARD_UI_THEME';

/** Reads the persisted theme preference or system preference as fallback. */
function resolveInitialTheme(): Theme {
  try {
    const saved = localStorage.getItem(STORAGE_KEY);
    if (saved === 'dark' || saved === 'light') return saved;
  } catch {
    // localStorage may be blocked in certain environments
  }
  return window.matchMedia?.('(prefers-color-scheme: dark)').matches
    ? 'dark'
    : 'light';
}

/** Applies/removes the `dark` class on <html> for Tailwind's class-based dark mode. */
function applyThemeToDocument(theme: Theme) {
  const root = document.documentElement;
  if (theme === 'dark') {
    root.classList.add('dark');
    document.body?.classList.add('dark');
  } else {
    root.classList.remove('dark');
    document.body?.classList.remove('dark');
  }
}

export const ThemeProvider: React.FC<{ children: React.ReactNode }> = ({
  children,
}) => {
  const [theme, setTheme] = useState<Theme>(() => {
    const resolved = resolveInitialTheme();
    // Apply immediately before first paint to avoid flash
    applyThemeToDocument(resolved);
    return resolved;
  });

  // Sync <html> class whenever theme changes
  useEffect(() => {
    applyThemeToDocument(theme);
    try {
      localStorage.setItem(STORAGE_KEY, theme);
    } catch {
      // ignore
    }
  }, [theme]);

  const toggleTheme = useCallback(
    (event?: React.MouseEvent | { clientX: number; clientY: number }) => {
      const nextTheme: Theme = theme === 'light' ? 'dark' : 'light';

      const isReducedMotion =
        typeof window !== 'undefined' &&
        window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
      const hasViewTransition =
        typeof document !== 'undefined' && 'startViewTransition' in document;

      if (!hasViewTransition || isReducedMotion) {
        setTheme(nextTheme);
        applyThemeToDocument(nextTheme);
        return;
      }

      // Calculate exact center of toggle button or click point
      let x = window.innerWidth / 2;
      let y = window.innerHeight / 2;

      if (event) {
        if ('currentTarget' in event && event.currentTarget) {
          const rect = (event.currentTarget as HTMLElement).getBoundingClientRect();
          x = rect.left + rect.width / 2;
          y = rect.top + rect.height / 2;
        } else if ('clientX' in event && typeof (event as any).clientX === 'number') {
          x = (event as any).clientX;
          y = (event as any).clientY;
        }
      }

      const endRadius = Math.hypot(
        Math.max(x, window.innerWidth - x),
        Math.max(y, window.innerHeight - y)
      ) + 32;

      const transition = (document as any).startViewTransition(() => {
        flushSync(() => {
          setTheme(nextTheme);
          applyThemeToDocument(nextTheme);
        });
      });

      const DURATION = 460;
      const EASING = 'cubic-bezier(0.22, 1, 0.36, 1)';

      transition.ready.then(() => {
        // 1. Subtle optical brightness yield on outgoing layer (anchored, zero jitter)
        document.documentElement.animate(
          {
            filter: [
              'brightness(1)',
              nextTheme === 'dark' ? 'brightness(0.92)' : 'brightness(1.04)',
            ],
          },
          {
            duration: DURATION,
            easing: EASING,
            pseudoElement: '::view-transition-old(root)',
          }
        );

        // 2. High-precision glowing circular wavefront expanding from button center
        document.documentElement.animate(
          {
            clipPath: [
              `circle(0px at ${x}px ${y}px)`,
              `circle(${endRadius}px at ${x}px ${y}px)`,
            ],
          },
          {
            duration: DURATION,
            easing: EASING,
            pseudoElement: '::view-transition-new(root)',
          }
        );
      });
    },
    [theme]
  );

  const value = useMemo<ThemeContextValue>(
    () => ({ theme, toggleTheme, isDark: theme === 'dark' }),
    [theme, toggleTheme]
  );

  return (
    <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>
  );
};

export function useTheme(): ThemeContextValue {
  const ctx = useContext(ThemeContext);
  if (!ctx) throw new Error('useTheme must be used within ThemeProvider');
  return ctx;
}
