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
      className={`
        group relative w-8 h-8 sm:w-9 sm:h-9 rounded-full flex items-center justify-center
        border transition-all duration-200 cursor-pointer shrink-0 shadow-xs
        active:scale-90
        ${isDark
          ? 'bg-slate-800 border-slate-700 text-amber-400 hover:bg-slate-700 hover:border-slate-600 hover:shadow-amber-500/10'
          : 'bg-white border-slate-200/80 text-slate-700 hover:bg-slate-50 hover:shadow-blue-500/10'
        }
      `}
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
              : 'rotate-0 scale-100 opacity-100 text-slate-700'
          }`}
        />
      </div>
    </button>
  );
};
