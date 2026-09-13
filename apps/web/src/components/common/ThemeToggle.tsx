import React from 'react';
import { Moon, Sun } from 'lucide-react';
import { useTheme } from '../../context/ThemeContext';

export const ThemeToggle: React.FC = () => {
  const { toggleTheme, isDark } = useTheme();

  return (
    <button
      type="button"
      onClick={(e) => toggleTheme(e)}
      aria-label={isDark ? 'Switch to light mode' : 'Switch to dark mode'}
      title={isDark ? 'Switch to light mode' : 'Switch to dark mode'}
      className="group relative w-9 h-9 rounded-xl flex items-center justify-center border border-card-border bg-card text-fg-muted hover:text-fg hover:border-primary/50 transition-all duration-200 cursor-pointer shrink-0 shadow-xs active:scale-95"
    >

      <div className="relative w-4 h-4 flex items-center justify-center pointer-events-none overflow-hidden">
        <Sun
          className={`w-4 h-4 transition-all duration-300 transform absolute ${
            isDark
              ? 'rotate-0 scale-100 opacity-100 text-amber-400'
              : '-rotate-90 scale-0 opacity-0'
          }`}
        />
        <Moon
          className={`w-4 h-4 transition-all duration-300 transform absolute ${
            isDark
              ? 'rotate-90 scale-0 opacity-0'
              : 'rotate-0 scale-100 opacity-100 text-fg-muted'
          }`}
        />
      </div>
    </button>
  );
};
