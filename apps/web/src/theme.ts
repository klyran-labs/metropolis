export type ThemeMode = "light" | "dark" | "system";
export type ResolvedTheme = "light" | "dark";

const STORAGE_KEY = "agentguard-theme";

// Validated categorical/status/sequential palette (dataviz skill reference instance).
// Ordering and steps are the CVD-safety mechanism; do not reorder without re-validating.
export const chartPalette: Record<ResolvedTheme, {
  surface: string;
  page: string;
  ink: string;
  inkSecondary: string;
  inkMuted: string;
  grid: string;
  baseline: string;
  categorical: string[];
  good: string;
  warning: string;
  serious: string;
  critical: string;
  sequential: string[];
}> = {
  light: {
    surface: "#ffffff",
    page: "#f8fafc",
    ink: "#0f172a",
    inkSecondary: "#475569",
    inkMuted: "#94a3b8",
    grid: "#e2e8f0",
    baseline: "#cbd5e1",
    categorical: [
      "#4f46e5",
      "#0284c7",
      "#059669",
      "#d97706",
      "#db2777",
      "#7c3aed",
      "#0891b2",
      "#dc2626",
    ],
    good: "#059669",
    warning: "#d97706",
    serious: "#ea580c",
    critical: "#dc2626",
    sequential: ["#e0e7ff", "#c7d2fe", "#a5b4fc", "#818cf8", "#6366f1", "#4f46e5", "#3730a3"],
  },
  dark: {
    surface: "#1a1a19",
    page: "#0d0d0d",
    ink: "#ffffff",
    inkSecondary: "#c3c2b7",
    inkMuted: "#898781",
    grid: "#2c2c2a",
    baseline: "#383835",
    categorical: [
      "#3987e5",
      "#d95926",
      "#199e70",
      "#c98500",
      "#d55181",
      "#008300",
      "#9085e9",
      "#e66767",
    ],
    good: "#0ca30c",
    warning: "#fab219",
    serious: "#ec835a",
    critical: "#d03b3b",
    sequential: ["#cde2fb", "#9ec5f4", "#6da7ec", "#3987e5", "#256abf", "#184f95", "#0d366b"],
  },
};

export function getStoredTheme(): ThemeMode {
  if (typeof window === "undefined") return "system";
  const stored = window.localStorage.getItem(STORAGE_KEY);
  return stored === "light" || stored === "dark" || stored === "system" ? stored : "system";
}

function systemPrefersDark(): boolean {
  return (
    typeof window !== "undefined" &&
    window.matchMedia("(prefers-color-scheme: dark)").matches
  );
}

export function resolveTheme(mode: ThemeMode): ResolvedTheme {
  return mode === "system" ? (systemPrefersDark() ? "dark" : "light") : mode;
}

function suppressTransitionsDuringUpdate(fn: () => void) {
  if (typeof document === "undefined") {
    fn();
    return;
  }

  // Flag the document while the theme changes; a static rule in globals.css disables transitions
  // for the duration. This prevents the flicker (background fading while text snaps) during a
  // global theme switch, and avoids injecting <style> elements that a strict policy would block.
  const root = document.documentElement;
  root.setAttribute("data-theme-switching", "");

  try {
    fn();
    // Force layout reflow so theme custom properties take effect synchronously
    // without triggering any CSS transitions.
    if (document.body) {
      void window.getComputedStyle(document.body).opacity;
    }
  } finally {
    // Resume transitions on the next frame so interactive transitions work again.
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        root.removeAttribute("data-theme-switching");
      });
    });
  }
}

export function applyTheme(mode: ThemeMode) {
  if (typeof document === "undefined") return;
  const resolved = resolveTheme(mode);
  const targetTheme = mode === "system" ? "" : mode;

  // If already set to target, skip redundant work
  if (
    document.documentElement.dataset.theme === targetTheme &&
    document.documentElement.style.colorScheme === resolved
  ) {
    try {
      window.localStorage.setItem(STORAGE_KEY, mode);
    } catch {
      // Ignore storage errors in restricted contexts
    }
    return;
  }

  suppressTransitionsDuringUpdate(() => {
    document.documentElement.dataset.theme = targetTheme;
    document.documentElement.style.colorScheme = resolved;
    try {
      window.localStorage.setItem(STORAGE_KEY, mode);
    } catch {
      // Ignore storage errors in restricted contexts
    }
  });

  // Dispatch custom theme change event so all React hooks, navigations, and charts sync instantly
  if (typeof window !== "undefined") {
    window.dispatchEvent(
      new CustomEvent("agentguard:theme-change", {
        detail: { mode, resolved },
      }),
    );
  }
}
