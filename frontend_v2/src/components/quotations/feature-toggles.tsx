"use client";

import { Sparkles } from "lucide-react";
import { cn } from "@/lib/utils";
import type { FeatureOption } from "@/services/quotation";

interface FeatureTogglesProps {
  options: FeatureOption[];
  value: Record<string, boolean>;
  masterDefaults?: Record<string, boolean>;
  onChange: (next: Record<string, boolean>) => void;
}

const FALLBACK_OPTIONS: FeatureOption[] = [
  { key: "has_zipper", label: "Zipper" },
  { key: "has_valve", label: "One-way valve" },
  { key: "has_window", label: "Window patch" },
  { key: "has_tear_notch", label: "Tear notch" },
  { key: "has_hang_hole", label: "Hang hole" },
  { key: "finish_matte", label: "Matte finish" },
  { key: "has_white_ink_layer", label: "White ink underlay" },
  { key: "has_metallised_layer", label: "Metallised layer" },
];

export default function FeatureToggles({
  options,
  value,
  masterDefaults,
  onChange,
}: FeatureTogglesProps) {
  const resolved = options.length > 0 ? options : FALLBACK_OPTIONS;

  return (
    <div className="rounded-xl border border-line p-4 bg-gradient-to-br from-white to-warning-bg">
      <div className="flex items-center gap-2 mb-3">
        <Sparkles className="h-4 w-4 text-warning-fg" />
        <span className="text-[10px] font-extrabold uppercase tracking-widest text-content-3">
          Feature options
        </span>
        <span className="text-[10px] font-bold text-content-4">
          · Toggle per quote line
        </span>
      </div>
      <div className="flex flex-wrap gap-1.5">
        {resolved.map((opt) => {
          const on = Boolean(value[opt.key]);
          const masterOn = Boolean(masterDefaults?.[opt.key]);
          const differs = masterDefaults !== undefined && on !== masterOn;
          return (
            <button
              key={opt.key}
              type="button"
              onClick={() => onChange({ ...value, [opt.key]: !on })}
              className={cn(
                "relative inline-flex items-center gap-1.5 h-8 px-3 rounded-full text-[11px] font-extrabold uppercase tracking-wider ring-1 transition",
                on
                  ? "bg-warning-fg text-white ring-warning-border shadow-sm hover:bg-warning-fg"
                  : "bg-surface-1 text-content-3 ring-line hover:bg-warning-bg hover:ring-warning-border",
              )}
            >
              <span
                className={cn(
                  "h-1.5 w-1.5 rounded-full",
                  on ? "bg-surface-1" : "bg-line",
                )}
              />
              {opt.label}
              {differs ? (
                <span className="absolute -top-1 -right-1 inline-flex h-3 w-3 items-center justify-center rounded-full bg-danger-solid text-[8px] font-extrabold text-white shadow">
                  !
                </span>
              ) : null}
            </button>
          );
        })}
      </div>
    </div>
  );
}
