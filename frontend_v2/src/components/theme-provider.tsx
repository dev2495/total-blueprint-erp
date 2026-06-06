"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from "react";

type ThemeMode = "light" | "dark";

type ThemeContextValue = {
  theme: ThemeMode;
  setTheme: (theme: ThemeMode, origin?: ThemeOrigin) => void;
  toggleTheme: (origin?: ThemeOrigin) => void;
};

const STORAGE_KEY = "tpp-theme";
const ThemeContext = createContext<ThemeContextValue | null>(null);
type ThemeOrigin = { x: number; y: number };

type ViewTransitionDocument = Document & {
  startViewTransition?: (callback: () => void) => { finished: Promise<void> };
};

function readInitialTheme(): ThemeMode {
  if (typeof document !== "undefined") {
    const current = document.documentElement.dataset.theme;
    if (current === "dark" || current === "light") return current;
  }
  return "light";
}

function applyTheme(theme: ThemeMode) {
  const root = document.documentElement;
  root.dataset.theme = theme;
  root.style.colorScheme = theme;
  root.classList.toggle("dark", theme === "dark");
}

export function ThemeProvider({ children }: { children: React.ReactNode }) {
  const [theme, setThemeState] = useState<ThemeMode>(readInitialTheme);

  useEffect(() => {
    applyTheme(theme);
    window.localStorage.setItem(STORAGE_KEY, theme);
    document.documentElement.classList.add("theme-ready");
  }, [theme]);

  const setTheme = useCallback((nextTheme: ThemeMode, origin?: ThemeOrigin) => {
    const root = document.documentElement;
    const x = Math.round(origin?.x ?? window.innerWidth - 112);
    const y = Math.round(origin?.y ?? 54);
    root.style.setProperty("--theme-origin-x", `${x}px`);
    root.style.setProperty("--theme-origin-y", `${y}px`);
    root.dataset.themeTarget = nextTheme;
    root.classList.add("theme-transitioning");

    const finishTransition = () => {
      window.setTimeout(() => {
        root.classList.remove("theme-transitioning");
        delete root.dataset.themeTarget;
      }, 120);
    };

    const viewTransition = (document as ViewTransitionDocument)
      .startViewTransition;
    if (viewTransition && !window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
      viewTransition.call(document, () => {
        setThemeState(nextTheme);
      }).finished.finally(finishTransition);
      return;
    }

    setThemeState(nextTheme);
    window.setTimeout(finishTransition, 720);
  }, []);

  const toggleTheme = useCallback((origin?: ThemeOrigin) => {
    setTheme(theme === "dark" ? "light" : "dark", origin);
  }, [setTheme, theme]);

  const value = useMemo(
    () => ({
      theme,
      setTheme,
      toggleTheme,
    }),
    [setTheme, theme, toggleTheme],
  );

  return (
    <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>
  );
}

export function useTheme() {
  const context = useContext(ThemeContext);
  if (!context) {
    throw new Error("useTheme must be used inside ThemeProvider");
  }
  return context;
}
