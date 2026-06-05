"use client";

import * as React from "react";
import { cn } from "@/lib/utils";
import {
  Box,
  Boxes,
  Database,
  Layers,
  Palette,
  PackageCheck,
  UserSquare,
} from "lucide-react";
import type { LaunchMode, CommitmentScope } from "@/services/product-master";

interface LaunchModeGridProps {
  value: LaunchMode;
  onChange: (mode: LaunchMode) => void;
  className?: string;
}

const MODES: Array<{
  id: LaunchMode;
  label: string;
  icon: React.ReactNode;
  description: string;
  scope: string;
  accent: string;
}> = [
  {
    id: "GENERIC",
    label: "Generic WIP / roll stock",
    icon: <Database className="h-4 w-4" />,
    description:
      "Make WIP that any compatible sales line can pull. Stop the route mid-way and defer artwork/customer when reuse is safe.",
    scope: "Scope: Generic",
    accent: "border-info-border bg-info-bg text-primary",
  },
  {
    id: "CUSTOMER",
    label: "Customer committed",
    icon: <UserSquare className="h-4 w-4" />,
    description: "Build stock dedicated to a customer before artwork.",
    scope: "Scope: Customer",
    accent: "border-warning-border bg-warning-bg text-warning-fg",
  },
  {
    id: "ARTWORK",
    label: "Artwork committed",
    icon: <Palette className="h-4 w-4" />,
    description: "Build stock with artwork commitment (e.g. print-ready).",
    scope: "Scope: Artwork",
    accent: "border-order-border bg-order-bg text-order-fg",
  },
  {
    id: "CUSTOMER_ARTWORK",
    label: "Customer + artwork",
    icon: <Layers className="h-4 w-4" />,
    description: "Lock customer and artwork together.",
    scope: "Scope: Both",
    accent: "border-danger-border bg-danger-bg text-danger-fg",
  },
  {
    id: "PACKAGING",
    label: "Packaging stock",
    icon: <Box className="h-4 w-4" />,
    description: "Build finished packing items (bags, cases, sleeves etc.).",
    scope: "Scope: Packaging",
    accent: "border-success-border bg-success-bg text-success-fg",
  },
  {
    id: "POD",
    label: "POD stock",
    icon: <PackageCheck className="h-4 w-4" />,
    description:
      "Build pre-positioned POD inventory pre-pinned to defined orders.",
    scope: "Scope: POD",
    accent: "border-order-border bg-order-bg text-order-fg",
  },
];

export function LaunchModeGrid({
  value,
  onChange,
  className,
}: LaunchModeGridProps) {
  return (
    <div className={cn("grid gap-3 sm:grid-cols-2 lg:grid-cols-6", className)}>
      {MODES.map((m) => {
        const active = m.id === value;
        return (
          <button
            key={m.id}
            type="button"
            onClick={() => onChange(m.id)}
            className={cn(
              "relative flex flex-col items-start gap-2 rounded-2xl border bg-surface-1 p-4 text-left transition focus:outline-none focus-visible:ring-2 focus-visible:ring-primary",
              active
                ? "border-primary ring-2 ring-info-border shadow-md"
                : "border-line hover:border-line-strong hover:shadow-sm",
            )}
          >
            <span
              className={cn(
                "inline-flex h-8 w-8 items-center justify-center rounded-lg ring-1 ring-inset",
                active
                  ? "bg-primary text-white ring-surface-1"
                  : "bg-surface-2 text-content-2 ring-line",
              )}
            >
              {m.icon}
            </span>
            <div>
              <div className="text-sm font-bold leading-tight text-content-1">
                {m.label}
              </div>
              <p className="mt-1 text-[11px] leading-4 text-content-3">
                {m.description}
              </p>
            </div>
            <span
              className={cn(
                "mt-1 inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-bold ring-1 ring-inset",
                m.accent,
              )}
            >
              {m.scope}
            </span>
            {active ? (
              <span className="absolute right-3 top-3 flex h-5 w-5 items-center justify-center rounded-full bg-primary text-[10px] font-bold text-white">
                ✓
              </span>
            ) : null}
          </button>
        );
      })}
    </div>
  );
}

interface CommitmentScopeSelectorProps {
  value: CommitmentScope;
  onChange: (scope: CommitmentScope) => void;
  className?: string;
}

export function CommitmentScopeSelector({
  value,
  onChange,
  className,
}: CommitmentScopeSelectorProps) {
  const scopes: Array<{ id: CommitmentScope; label: string }> = [
    { id: "GENERIC", label: "Generic" },
    { id: "CUSTOMER", label: "Customer" },
    { id: "ARTWORK", label: "Artwork" },
    { id: "CUSTOMER_ARTWORK", label: "Customer + Artwork" },
  ];
  return (
    <div className={cn("flex flex-wrap gap-2", className)}>
      {scopes.map((s) => {
        const active = s.id === value;
        return (
          <button
            key={s.id}
            type="button"
            onClick={() => onChange(s.id)}
            className={cn(
              "rounded-full px-3 py-1.5 text-xs font-bold uppercase tracking-wider ring-1 ring-inset transition",
              active
                ? "bg-primary text-white ring-primary shadow"
                : "bg-surface-1 text-content-2 ring-line hover:bg-surface-2",
            )}
          >
            {s.label}
          </button>
        );
      })}
    </div>
  );
}
