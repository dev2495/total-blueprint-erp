"use client";

/**
 * Section list for the product master editor. On wide screens it is a vertical list in its
 * own column; on smaller screens it becomes a sticky bar above the form. Every section stays
 * where it is; the list jumps to it and shows which one is in view.
 */
import { useEffect, useState } from "react";

import { cn } from "@/lib/utils";

/** Every section keeps its place on the page; the list groups them under the three questions a
 *  master answers: what it is, what is fixed, what sales may choose. */
const GROUPS: Array<{ key: string; label: string }> = [
  { key: "what", label: "What it is" },
  { key: "fixed", label: "What is fixed" },
  { key: "sales", label: "What sales choose" },
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

export function PmStepNav({ className }: { className?: string }) {
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
      className={cn(
        "sticky top-2 z-20 -mx-1 self-start overflow-x-auto rounded-[16px] border border-line bg-surface-1/95 px-2 py-2 shadow-[var(--shadow-sm)] backdrop-blur",
        "2xl:top-20 2xl:mx-0 2xl:overflow-visible 2xl:border-0 2xl:bg-transparent 2xl:px-0 2xl:py-0 2xl:shadow-none 2xl:backdrop-blur-none",
        className,
      )}
      data-testid="pm-step-nav"
    >
      <ol className="flex min-w-max items-center gap-1.5 2xl:min-w-0 2xl:flex-col 2xl:items-stretch 2xl:gap-0.5">
        {steps.map((step, index) => (
          <li key={step.id} className="flex items-center gap-1.5 2xl:block">
            {index === 0 || steps[index - 1].group !== step.group ? (
              <span
                className={cn(
                  "ml-1 mr-0.5 whitespace-nowrap text-[11px] font-semibold uppercase tracking-[0.09em] text-content-4",
                  "2xl:mx-0 2xl:block 2xl:px-2.5 2xl:pb-1.5",
                  index > 0 && "2xl:pt-4",
                )}
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
                "inline-flex items-center gap-2.5 whitespace-nowrap rounded-full px-3 py-1.5 text-[13px] font-medium transition-colors",
                "2xl:flex 2xl:w-full 2xl:rounded-[10px] 2xl:px-2.5 2xl:py-2",
                active === step.id
                  ? "bg-primary text-primary-foreground 2xl:bg-surface-1 2xl:text-content-1 2xl:shadow-[var(--shadow-md)]"
                  : "text-content-2 hover:bg-surface-2",
              )}
            >
              <span
                className={cn(
                  "inline-flex h-5 min-w-5 items-center justify-center rounded-full text-[10.5px] font-semibold",
                  active === step.id ? "bg-white/20 2xl:bg-info-bg 2xl:text-primary" : "bg-surface-2 text-content-3 ring-1 ring-line",
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
