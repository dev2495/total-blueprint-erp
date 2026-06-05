"use client";

import { useEffect, useRef, useState } from "react";

import { cn } from "@/lib/utils";

type ChartSurfaceRender = (dimensions: {
  width: number;
  height: number;
}) => React.ReactNode;

interface ChartSurfaceProps {
  className?: string;
  loadingLabel?: string;
  children: React.ReactNode | ChartSurfaceRender;
}

export function ChartSurface({
  className,
  loadingLabel = "Loading chart…",
  children,
}: ChartSurfaceProps) {
  const [mounted, setMounted] = useState(false);
  const [dimensions, setDimensions] = useState({ width: 0, height: 0 });
  const ref = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    setMounted(true);
  }, []);

  useEffect(() => {
    if (!mounted || !ref.current || typeof ResizeObserver === "undefined")
      return;

    const element = ref.current;
    const observer = new ResizeObserver((entries) => {
      const entry = entries[0];
      if (!entry) return;
      const width = Math.floor(entry.contentRect.width);
      const height = Math.floor(entry.contentRect.height);
      if (width > 0 && height > 0) {
        setDimensions((prev) =>
          prev.width === width && prev.height === height
            ? prev
            : { width, height },
        );
      }
    });

    observer.observe(element);
    return () => observer.disconnect();
  }, [mounted]);

  const ready = mounted && dimensions.width > 0 && dimensions.height > 0;

  if (!ready) {
    return (
      <div
        ref={ref}
        className={cn(
          "grid h-full min-h-[280px] w-full place-items-center text-sm text-content-4",
          className,
        )}
      >
        {loadingLabel}
      </div>
    );
  }

  return (
    <div ref={ref} className={cn("h-full min-h-[280px] w-full", className)}>
      {typeof children === "function"
        ? (children as ChartSurfaceRender)(dimensions)
        : children}
    </div>
  );
}
