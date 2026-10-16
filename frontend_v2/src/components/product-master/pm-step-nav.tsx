"use client";

/**
 * Sticky step bar for the long product master edit page. Every section stays where it
 * is; the bar jumps to it and shows which one is in view.
 */
import { useEffect, useState } from "react";

import { cn } from "@/lib/utils";

/** Every section keeps its place on the page; the bar groups them under the three questions a
 *  master answers: what it is, what is fixed, what sales may choose. */
const GROUPS: Array<{ key: string; label: string }> = [
  { key: "what", label: "1 · What it is" },
  { key: "fixed", label: "2 · What is fixed" },
  { key: "sales", label: "3 · What sales choose" },
];

const STEPS: Array<{ id: string; label: string; group: string }> = [
  { id: "pm-basics", label: "Basics", group: "what" },
  { id: "pm-rules", label: "Summary", group: "what" },
  { id: "pm-layers", label: "Layers", group: "fixed" },
  { id: "pm-printing", label: "Printing", group: "fixed" },
  { id: "pm-chemistry", label: "Adhesive", group: "fixed" },
  { id: "pm-sales-choices", label: "What sales can change", group: "sales" },
  { id: "pm-sizes", label: "Sizes & web width", group: "sales" },
  { id: "pm-addons", label: "Add-ons & packing", group: "sales" },
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
          <li key={step.id} className="flex items-center gap-1.5">
            {index === 0 || steps[index - 1].group !== step.group ? (
              <span
                className="ml-1 mr-0.5 whitespace-nowrap text-[10px] font-bold uppercase tracking-[0.12em] text-content-4"
                data-testid={`pm-step-group-${step.group}`}
              >
                {GROUPS.find((g) => g.key === step.group)?.label}
              </span>
            ) : null}
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
