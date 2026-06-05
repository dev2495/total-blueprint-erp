"use client";

import * as React from "react";
import { cn } from "@/lib/utils";
import { Chip, ChipGroup } from "./chip";

export interface AxisOption {
  value: string | number;
  label?: React.ReactNode;
  hint?: React.ReactNode;
  disabled?: boolean;
}

export interface AxisDefinition {
  axis: string;
  label?: string;
  type?: string;
  required?: boolean;
  scope?: string;
  group?: "geometry" | "materials" | "finishing" | string;
  options?: Array<AxisOption | string | number | Record<string, any>>;
  unit?: string;
  default_value?: any;
  allow_custom?: boolean;
  description?: string;
}

export interface AxisEditorProps extends React.HTMLAttributes<HTMLDivElement> {
  axes: AxisDefinition[];
  values: Record<string, any>;
  onChange: (next: Record<string, any>) => void;
  groupFilter?: AxisDefinition["group"];
  errors?: Record<string, string | string[]>;
  density?: "compact" | "normal";
  inline?: boolean;
}

function normalizeOption(opt: AxisOption | string | number | Record<string, any>): AxisOption {
  if (typeof opt === "string" || typeof opt === "number") return { value: opt, label: String(opt) };
  if (typeof opt === "object" && opt !== null) {
    const o = opt as Record<string, any>;
    const value = o.value ?? o.code ?? o.id ?? o.label ?? "";
    const label = o.label ?? o.name ?? o.code ?? String(value);
    return {
      value,
      label,
      hint: o.hint ?? o.description ?? undefined,
      disabled: o.disabled ?? o.active === false,
    };
  }
  return { value: "", label: "—" };
}

function humanize(s: string) {
  return s.replace(/[_\-]/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
}

export const AxisEditor = React.forwardRef<HTMLDivElement, AxisEditorProps>(
  (
    {
      className,
      axes,
      values,
      onChange,
      groupFilter,
      errors,
      density = "normal",
      inline,
      ...props
    },
    ref,
  ) => {
    const filtered = React.useMemo(() => {
      if (!groupFilter) return axes;
      return axes.filter(
        (a) => (a.group ?? inferGroup(a.axis, a.type)) === groupFilter,
      );
    }, [axes, groupFilter]);

    const update = (axis: string, value: any) => {
      onChange({ ...values, [axis]: value });
    };

    if (filtered.length === 0) {
      return (
        <div
          ref={ref}
          className={cn(
            "rounded-lg border border-dashed border-slate-200 bg-slate-50/50 p-4 text-xs text-slate-500",
            className,
          )}
          {...props}
        >
          No axes for this group.
        </div>
      );
    }

    return (
      <div
        ref={ref}
        className={cn(
          "flex flex-col",
          inline ? "gap-2" : density === "compact" ? "gap-2" : "gap-3",
          className,
        )}
        {...props}
      >
        {filtered.map((axis) => {
          const label = axis.label ?? humanize(axis.axis);
          const current = values?.[axis.axis] ?? "";
          const opts = (axis.options ?? []).map(normalizeOption);
          const errMsg = errors?.[axis.axis];
          const errText = Array.isArray(errMsg) ? errMsg[0] : errMsg;
          const renderInput = chooseInputKind(axis, opts);

          return (
            <div
              key={axis.axis}
              className={cn(
                "flex flex-col gap-1.5 rounded-lg border bg-surface-1 px-3 py-2",
                errText ? "border-rose-300 ring-1 ring-rose-100" : "border-slate-200",
              )}
            >
              <div className="flex items-center justify-between gap-2">
                <label className="flex items-center gap-1.5 text-[12px] font-semibold text-slate-700">
                  {label}
                  {axis.required && <span className="text-rose-500">*</span>}
                  {axis.unit && <span className="text-[10px] font-normal text-content-4">{axis.unit}</span>}
                </label>
                {axis.scope && axis.scope !== "order" && (
                  <Chip kind="neutral" size="sm">
                    {axis.scope}
                  </Chip>
                )}
              </div>

              {renderInput === "chips" && (
                <ChipGroup>
                  {opts.map((opt) => {
                    const selected = String(current) === String(opt.value);
                    return (
                      <Chip
                        key={String(opt.value)}
                        kind={selected ? "process" : "neutral"}
                        asButton
                        onClick={() => !opt.disabled && update(axis.axis, opt.value)}
                        className={cn(
                          opt.disabled && "opacity-40 cursor-not-allowed",
                          selected && "ring-2 ring-blue-300",
                        )}
                      >
                        {opt.label}
                      </Chip>
                    );
                  })}
                </ChipGroup>
              )}

              {renderInput === "select" && (
                <select
                  value={String(current ?? "")}
                  onChange={(e) => update(axis.axis, e.target.value)}
                  className="h-9 rounded-md border border-slate-200 bg-surface-1 px-2 text-sm outline-none transition-colors focus:border-blue-400 focus:ring-2 focus:ring-blue-100"
                >
                  <option value="">— select —</option>
                  {opts.map((opt) => (
                    <option key={String(opt.value)} value={String(opt.value)} disabled={opt.disabled}>
                      {opt.label}
                    </option>
                  ))}
                </select>
              )}

              {renderInput === "number" && (
                <input
                  type="number"
                  value={current === "" || current == null ? "" : Number(current)}
                  onChange={(e) =>
                    update(axis.axis, e.target.value === "" ? null : Number(e.target.value))
                  }
                  className="h-9 rounded-md border border-slate-200 bg-surface-1 px-2 font-mono-token text-sm outline-none transition-colors focus:border-blue-400 focus:ring-2 focus:ring-blue-100"
                />
              )}

              {renderInput === "boolean" && (
                <ChipGroup>
                  {[
                    { value: true, label: "Yes" },
                    { value: false, label: "No" },
                  ].map((opt) => {
                    const selected = current === opt.value;
                    return (
                      <Chip
                        key={String(opt.value)}
                        kind={selected ? (opt.value ? "success" : "danger") : "neutral"}
                        asButton
                        onClick={() => update(axis.axis, opt.value)}
                      >
                        {opt.label}
                      </Chip>
                    );
                  })}
                </ChipGroup>
              )}

              {renderInput === "text" && (
                <input
                  type="text"
                  value={current ?? ""}
                  onChange={(e) => update(axis.axis, e.target.value)}
                  className="h-9 rounded-md border border-slate-200 bg-surface-1 px-2 text-sm outline-none transition-colors focus:border-blue-400 focus:ring-2 focus:ring-blue-100"
                />
              )}

              {axis.description && (
                <span className="text-[10px] text-content-4">{axis.description}</span>
              )}

              {errText && <span className="text-[11px] text-rose-600">{errText}</span>}
            </div>
          );
        })}
      </div>
    );
  },
);
AxisEditor.displayName = "AxisEditor";

function chooseInputKind(
  axis: AxisDefinition,
  opts: AxisOption[],
): "chips" | "select" | "number" | "boolean" | "text" {
  const t = (axis.type ?? "").toLowerCase();
  if (t === "boolean" || t === "bool") return "boolean";
  if (opts.length > 0) {
    if (opts.length <= 6) return "chips";
    return "select";
  }
  if (t === "number" || t === "int" || t === "float" || t === "decimal") return "number";
  return "text";
}

function inferGroup(axis: string, type?: string): "geometry" | "materials" | "finishing" | "other" {
  const a = axis.toLowerCase();
  if (
    a.includes("width") ||
    a.includes("height") ||
    a.includes("gusset") ||
    a.includes("size") ||
    a.includes("thick") ||
    a.includes("micron") ||
    a.includes("pouch") ||
    a.includes("roll")
  ) {
    return "geometry";
  }
  if (
    a.includes("grade") ||
    a.includes("material") ||
    a.includes("film") ||
    a.includes("layer") ||
    a.includes("ink") ||
    a.includes("adhesive")
  ) {
    return "materials";
  }
  if (
    a.includes("print") ||
    a.includes("seal") ||
    a.includes("finish") ||
    a.includes("color") ||
    a.includes("zipper") ||
    a.includes("spout") ||
    a.includes("handle")
  ) {
    return "finishing";
  }
  return "other";
}
