"use client";

import * as React from "react";

type AnimatedNumberProps = {
  value: number | null | undefined;
  /** Formats the in-flight and final value. Defaults to en-IN grouping. */
  format?: (value: number) => string;
  durationMs?: number;
  className?: string;
  fallback?: React.ReactNode;
};

const defaultFormat = (value: number) =>
  value.toLocaleString("en-IN", { maximumFractionDigits: Math.abs(value) < 100 ? 1 : 0 });

function prefersReducedMotion() {
  if (typeof window === "undefined" || !window.matchMedia) return true;
  return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

/**
 * Counts from the previous value to the next one with an ease-out curve.
 * It renders the final value on the server and on reduced-motion devices,
 * so the number is always correct even if the animation never runs.
 */
export function AnimatedNumber({
  value,
  format = defaultFormat,
  durationMs = 700,
  className,
  fallback = "—",
}: AnimatedNumberProps) {
  const target = typeof value === "number" && Number.isFinite(value) ? value : null;
  const [display, setDisplay] = React.useState<number | null>(target);
  const fromRef = React.useRef<number>(target ?? 0);

  React.useEffect(() => {
    if (target === null) {
      setDisplay(null);
      return;
    }
    const from = fromRef.current;
    if (prefersReducedMotion() || from === target) {
      fromRef.current = target;
      setDisplay(target);
      return;
    }
    let frame = 0;
    const started = performance.now();
    const tick = (now: number) => {
      const t = Math.min(1, (now - started) / durationMs);
      const eased = 1 - Math.pow(1 - t, 3);
      setDisplay(from + (target - from) * eased);
      if (t < 1) frame = requestAnimationFrame(tick);
      else fromRef.current = target;
    };
    frame = requestAnimationFrame(tick);
    return () => {
      cancelAnimationFrame(frame);
      fromRef.current = target;
    };
  }, [target, durationMs]);

  if (display === null || target === null) return <span className={className}>{fallback}</span>;
  const shown = Number.isInteger(target) ? Math.round(display) : display;
  return (
    <span className={className} aria-label={format(target)}>
      {format(shown)}
    </span>
  );
}
