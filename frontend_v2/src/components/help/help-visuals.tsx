"use client";

import type { DecisionFlow, HelpLocale } from "@/help/types";
import { localize } from "@/help/resolver";

export function HelpScreenshotImage({ imageKey, compact = false }: { imageKey: string; compact?: boolean }) {
  return (
    <img
      src={`/help/screenshots/${imageKey}.png`}
      alt={imageKey}
      className={compact ? "h-32 w-full rounded-lg border border-slate-200 object-cover" : "w-full rounded-md border border-slate-100 object-cover"}
      loading="lazy"
      onError={(event) => {
        const image = event.currentTarget;
        if (image.dataset.fallback === "svg") return;
        image.dataset.fallback = "svg";
        image.src = `/help/screenshots/${imageKey}.svg`;
      }}
    />
  );
}

export function HelpFlowDiagram({ flow, locale }: { flow?: DecisionFlow; locale: HelpLocale }) {
  const nodes = flow?.nodes || [];
  if (!nodes.length) {
    return (
      <div className="rounded-xl border border-dashed border-line-strong bg-slate-50 p-4 text-sm font-semibold text-slate-500">
        {locale === "hi" ? "Visual flow उपलब्ध नहीं है।" : "Visual flow is not available for this page."}
      </div>
    );
  }

  const nodeTitles = new Map(nodes.map((node) => [node.id, localize(node.title, locale)]));

  return (
    <div className="rounded-2xl border border-slate-200 bg-gradient-to-br from-white to-slate-50 p-4">
      <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
        <div>
          <div className="text-[10px] font-black uppercase tracking-[0.22em] text-blue-600">
            {locale === "hi" ? "Visual Flow" : "Visual Flow"}
          </div>
          <div className="text-base font-black text-slate-950">{flow ? localize(flow.title, locale) : "Workflow"}</div>
        </div>
        <div className="rounded-full border border-slate-200 bg-surface-1 px-3 py-1 text-[11px] font-bold text-content-3">
          {nodes.length} {locale === "hi" ? "steps" : "steps"}
        </div>
      </div>

      <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
        {nodes.map((node, index) => (
          <div key={node.id} className="relative rounded-xl border border-slate-200 bg-surface-1 p-3 shadow-sm">
            <div className="mb-3 flex items-start gap-3">
              <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-blue-700 text-sm font-black text-white">
                {index + 1}
              </div>
              <div className="min-w-0">
                <div className="text-sm font-black leading-5 text-slate-950">{localize(node.title, locale)}</div>
                <div className="mt-0.5 text-[10px] font-bold uppercase tracking-[0.16em] text-content-4">{node.id}</div>
              </div>
            </div>
            <div className="space-y-2">
              {node.outcomes.map((outcome, outcomeIndex) => {
                const target = outcome.nextId ? nodeTitles.get(outcome.nextId) : null;
                return (
                  <div key={`${node.id}-${outcomeIndex}`} className="rounded-lg border border-slate-100 bg-slate-50 px-3 py-2">
                    <div className="text-xs font-bold text-content-2">{localize(outcome.label, locale)}</div>
                    {target ? (
                      <div className="mt-1 text-[11px] font-semibold text-blue-700">{"->"} {target}</div>
                    ) : outcome.resolution ? (
                      <div className="mt-1 text-[11px] leading-4 text-content-3">{localize(outcome.resolution, locale)}</div>
                    ) : null}
                  </div>
                );
              })}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
