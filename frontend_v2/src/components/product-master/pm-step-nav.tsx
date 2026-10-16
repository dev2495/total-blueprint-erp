"use client";

/**
 * Sticky step bar for the long product master edit page. Every section stays where it
 * is; the bar jumps to it and shows which one is in view.
 */
import { useEffect, useState } from "react";

import { cn } from "@/lib/utils";

const STEPS: Array<{ id: string; label: string }> = [
  { id: "pm-basics", label: "Basics" },
  { id: "pm-rules", label: "Summary" },
  { id: "pm-sales-choices", label: "What sales can change" },
  { id: "pm-layers", label: "Layers" },
  { id: "pm-sizes", label: "Sizes & web width" },
  { id: "pm-printing", label: "Printing" },
  { id: "pm-chemistry", label: "Adhesive" },
  { id: "pm-addons", label: "Add-ons & packing" },
];

export function PmStepNav() {
  const [present, setPresent] = useState<string[]>([]);
  const [active, setActive] = useState<string>("pm-basics");

  useEffect(() => {
    const ids = STEPS.map((step) => step.id).filter((id) => document.getElementById(id));
    setPresent(ids);
    if (!("IntersectionObserver" in window) || !ids.length) return;
    const observer = new IntersectionObserver(
      (entries) => {
        const visible = entries.filter((entry) => entry.isIntersecting).sort((a, b) => a.boundingClientRect.top - b.boundingClientRect.top);
        if (visible[0]?.target?.id) setActive(visible[0].target.id);
      },
      { rootMargin: "-20% 0px -65% 0px" },
    );
    ids.forEach((id) => {
      const el = document.getElementById(id);
      if (el) observer.observe(el);
    });
    return () => observer.disconnect();
  }, []);

  const steps = STEPS.filter((step) => present.includes(step.id));
  if (!steps.length) return null;

  return (
    <nav
      aria-label="Product master sections"
      className="sticky top-2 z-20 -mx-1 overflow-x-auto rounded-2xl border border-line bg-surface-1/95 px-2 py-2 shadow-sm backdrop-blur"
      data-testid="pm-step-nav"
    >
      <ol className="flex min-w-max items-center gap-1.5">
        {steps.map((step, index) => (
          <li key={step.id}>
            <a
              href={`#${step.id}`}
              onClick={(event) => {
                event.preventDefault();
                document.getElementById(step.id)?.scrollIntoView({ behavior: "smooth", block: "start" });
                setActive(step.id);
              }}
              aria-current={active === step.id ? "step" : undefined}
              className={cn(
                "inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 text-xs font-semibold transition-colors",
                active === step.id ? "bg-primary text-primary-foreground" : "text-content-2 hover:bg-surface-2",
              )}
            >
              <span
                className={cn(
                  "inline-flex h-4 min-w-4 items-center justify-center rounded-full text-[10px]",
                  active === step.id ? "bg-white/20" : "bg-surface-2 text-content-3",
                )}
              >
                {index + 1}
              </span>
              {step.label}
            </a>
          </li>
        ))}
      </ol>
    </nav>
  );
}
