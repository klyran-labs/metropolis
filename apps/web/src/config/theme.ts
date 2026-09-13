/**
 * @file theme.ts
 * Authoritative Design System & Theme Configuration for AgentGuard.
 * 
 * All color tokens, surface elevations, status indicators, and role badges
 * are centrally configured here. Components consume these tokens via semantic
 * Tailwind utility classes (e.g. `bg-primary`, `bg-card`, `text-fg-muted`)
 * or this config object, guaranteeing zero un-tokenized ad-hoc styles.
 */

export interface ColorToken {
  light: string;
  dark: string;
}

export const THEME_CONFIG = {
  brand: {
    name: 'AgentGuard',
    // Monad Amethyst & Material Design 3 Purple
    primary: {
      light: '#7c3aed', // Royal Amethyst (WCAG AAA on light)
      dark: '#836ef9',  // Monad Electric Amethyst (signature glow)
    },
    primaryHover: {
      light: '#6d28d9',
      dark: '#9684fa',
    },
    primarySubtle: {
      light: 'rgba(124, 58, 237, 0.08)',
      dark: 'rgba(131, 110, 249, 0.15)',
    },
  },

  surfaces: {
    canvas: {
      light: '#f8f9fd', // Slate-lavender soft background
      dark: '#0b0c10',  // Deep matte obsidian
    },
    workspace: {
      light: '#ffffff',
      dark: '#0f1017',
    },
    card: {
      light: '#ffffff',
      dark: '#13141d',
    },
    cardMuted: {
      light: '#f3f4fa',
      dark: '#191a26',
    },
    cardElevated: {
      light: '#ffffff',
      dark: '#1e202f',
    },
    border: {
      light: '#e5e7f2',
      dark: '#232536',
    },
  },

  typography: {
    foreground: {
      light: '#0f172a', // Slate 900
      dark: '#f8fafc',  // Slate 50
    },
    foregroundMuted: {
      light: '#475569', // Slate 600
      dark: '#94a3b8',  // Slate 400
    },
    foregroundSubtle: {
      light: '#64748b', // Slate 500
      dark: '#64748b',  // Slate 500
    },
  },

  semantics: {
    success: {
      base: '#10b981',
      lightBg: '#ecfdf5',
      lightText: '#047857',
      lightBorder: '#a7f3d0',
      darkBg: 'rgba(6, 78, 59, 0.4)',
      darkText: '#34d399',
      darkBorder: 'rgba(16, 185, 129, 0.3)',
    },
    warning: {
      base: '#f59e0b',
      lightBg: '#fffbeb',
      lightText: '#b45309',
      lightBorder: '#fde68a',
      darkBg: 'rgba(120, 53, 15, 0.4)',
      darkText: '#fbbf24',
      darkBorder: 'rgba(245, 158, 11, 0.3)',
    },
    danger: {
      base: '#f43f5e',
      lightBg: '#fff1f2',
      lightText: '#be123c',
      lightBorder: '#fecdd3',
      darkBg: 'rgba(136, 19, 55, 0.4)',
      darkText: '#fb7185',
      darkBorder: 'rgba(244, 63, 94, 0.3)',
    },
    info: {
      base: '#7c3aed',
      lightBg: 'rgba(124, 58, 237, 0.08)',
      lightText: '#6d28d9',
      lightBorder: 'rgba(124, 58, 237, 0.2)',
      darkBg: 'rgba(131, 110, 249, 0.15)',
      darkText: '#a78bfa',
      darkBorder: 'rgba(131, 110, 249, 0.3)',
    },
  },

  // Authoritative Role Badges Configuration
  roles: {
    super_admin: {
      id: 'super_admin',
      label: 'Super Admin',
      badge: 'Super Admin (Root)',
      badgeClass: 'bg-indigo-50 text-indigo-700 border-indigo-200 dark:bg-indigo-950/60 dark:text-indigo-400 dark:border-indigo-700/40',
    },
    secops_engineer: {
      id: 'secops_engineer',
      label: 'Risk & SecOps',
      badge: 'Risk & SecOps',
      badgeClass: 'bg-rose-50 text-rose-700 border-rose-200 dark:bg-rose-950/60 dark:text-rose-400 dark:border-rose-700/40',
    },
    treasury_operator: {
      id: 'treasury_operator',
      label: 'Treasury Controller',
      badge: 'Treasury Controller',
      badgeClass: 'bg-amber-50 text-amber-800 border-amber-200 dark:bg-amber-950/60 dark:text-amber-400 dark:border-amber-700/40',
    },
    devops_engineer: {
      id: 'devops_engineer',
      label: 'Fleet DevOps',
      badge: 'Fleet DevOps',
      badgeClass: 'bg-purple-50 text-purple-700 border-purple-200 dark:bg-purple-950/60 dark:text-purple-400 dark:border-purple-700/40',
    },
    auditor: {
      id: 'auditor',
      label: 'Compliance Auditor',
      badge: 'Auditor (Read-Only)',
      badgeClass: 'bg-card-muted text-fg-muted border-card-border',
    },
  },
} as const;

export type ThemeConfig = typeof THEME_CONFIG;
