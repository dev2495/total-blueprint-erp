"use client";

import type { MouseEvent } from "react";
import { Moon, Sun } from "lucide-react";
import { useTheme } from "@/components/theme-provider";
import { cn } from "@/lib/utils";

export function ThemeToggle({ compact = false }: { compact?: boolean }) {
  const { theme, toggleTheme } = useTheme();
  const isDark = theme === "dark";
  const handleToggle = (event: MouseEvent<HTMLButtonElement>) => {
    const rect = event.currentTarget.getBoundingClientRect();
    toggleTheme({
      x: rect.left + rect.width / 2,
      y: rect.top + rect.height / 2,
    });
  };

  return (
    <button
      type="button"
      aria-label={isDark ? "Switch to light theme" : "Switch to dark theme"}
      title={isDark ? "Switch to light theme" : "Switch to dark theme"}
      aria-pressed={isDark}
      onClick={handleToggle}
      className={cn(
        "theme-toggle group relative inline-flex shrink-0 items-center justify-center overflow-hidden rounded-xl border border-line bg-surface-1 text-content-2 shadow-sm outline-none transition-all duration-300 hover:-translate-y-0.5 hover:border-line-strong hover:shadow-md focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2 focus-visible:ring-offset-surface-0 active:translate-y-0",
        compact ? "h-10 w-10" : "h-11 w-11",
      )}
      data-theme-toggle={isDark ? "dark" : "light"}
    >
      <span className="theme-toggle__halo" aria-hidden="true" />
      <span className="theme-toggle__orbit" aria-hidden="true">
        <Sun className="theme-toggle__icon theme-toggle__sun h-4.5 w-4.5" />
        <Moon className="theme-toggle__icon theme-toggle__moon h-4.5 w-4.5" />
      </span>
    </button>
  );
}
