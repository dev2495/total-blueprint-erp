"use client";

import { useQuery } from "@tanstack/react-query";
import { CheckCircle2, Layers3, Settings2, Wrench } from "lucide-react";

import { analyticsApi } from "@/services/analytics";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { PageHero } from "@/components/premium";

const SECTION_ICON = {
  SUPPORTED_NOW: CheckCircle2,
  CONFIG_ONLY: Settings2,
  NEW_LOGIC_REQUIRED: Wrench,
} as const;

const SECTION_TONE = {
  SUPPORTED_NOW: "border-success-border bg-success-bg",
  CONFIG_ONLY: "border-warning-border bg-warning-bg",
  NEW_LOGIC_REQUIRED: "border-danger-border bg-danger-bg",
} as const;

function safeToken(value: unknown, fallback: string) {
  const normalized = String(value || "").trim();
  return normalized || fallback;
}

function toList(value: unknown): string[] {
  return Array.isArray(value)
    ? value.map((item) => String(item || "").trim()).filter(Boolean)
    : [];
}

export default function CapabilityMatrixPage() {
  const { data, isLoading, isError } = useQuery({
    queryKey: ["analytics-capability-matrix"],
    queryFn: analyticsApi.getCapabilityMatrix,
  });

  if (isLoading) {
    return (
      <div className="p-6 text-sm text-content-3">
        Loading capability matrix...
      </div>
    );
  }

  if (isError || !data) {
    return (
      <div className="p-6 text-sm text-danger-fg">
        Capability matrix could not be loaded.
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-[1600px] space-y-4">
      <PageHero
        compact
        eyebrow="Capability Matrix"
        icon={<Layers3 />}
        title="What this ERP supports today, by configuration, or only with new logic"
        description="The support boundary for stock naming, rolls, pouches and future flexible-packaging extensions: taxonomy work versus real manufacturing logic."
      />

      {(Array.isArray(data.sections) ? data.sections : []).map(
        (section, sectionIndex) => {
          const sectionStatus = safeToken(
            section?.status,
            section?.label || `SECTION_${sectionIndex + 1}`,
          ).toUpperCase();
          const sectionLabel = safeToken(
            section?.label,
            sectionStatus.replaceAll("_", " "),
          );
          const Icon =
            SECTION_ICON[sectionStatus as keyof typeof SECTION_ICON] || Layers3;
          const tone =
            SECTION_TONE[sectionStatus as keyof typeof SECTION_TONE] ||
            "border-line bg-surface-1";
          return (
            <div key={`${sectionStatus}-${sectionIndex}`} className="space-y-4">
              <div className={`rounded-2xl border px-5 py-4 ${tone}`}>
                <div className="flex items-center gap-3">
                  <div className="rounded-xl bg-surface-1/80 p-2">
                    <Icon className="h-5 w-5 text-content-1" />
                  </div>
                  <div>
                    <div className="text-[11px] font-semibold uppercase tracking-[0.12em] text-content-3">
                      {sectionStatus.replaceAll("_", " ")}
                    </div>
                    <div className="text-xl font-semibold tracking-tight text-content-1">
                      {sectionLabel}
                    </div>
                  </div>
                </div>
              </div>

              <div className="grid gap-4 lg:grid-cols-2">
                {(Array.isArray(section?.entries) ? section.entries : []).map(
                  (entry, entryIndex) => {
                    const family = safeToken(
                      entry?.capability_family,
                      `Capability ${entryIndex + 1}`,
                    );
                    const examples = toList(entry?.examples);
                    const configNeeded = toList(entry?.config_needed);
                    const codeNeeded = toList(entry?.code_needed);
                    const limits = toList(entry?.limits);
                    return (
                      <Card
                        key={`${sectionStatus}-${family}-${entryIndex}`}
                        className="border-line shadow-sm"
                      >
                        <CardHeader className="pb-3">
                          <CardTitle className="text-lg font-semibold text-content-1">
                            {family}
                          </CardTitle>
                        </CardHeader>
                        <CardContent className="space-y-4 text-sm">
                          <div>
                            <div className="text-[11px] font-semibold uppercase tracking-[0.1em] text-content-4">
                              What it means
                            </div>
                            <p className="mt-1 text-content-2">
                              {safeToken(
                                entry?.what_it_means,
                                "Capability summary unavailable.",
                              )}
                            </p>
                          </div>
                          <div>
                            <div className="text-[11px] font-semibold uppercase tracking-[0.1em] text-content-4">
                              Why
                            </div>
                            <p className="mt-1 text-content-2">
                              {safeToken(entry?.why, "Reasoning not provided.")}
                            </p>
                          </div>
                          <div>
                            <div className="text-[11px] font-semibold uppercase tracking-[0.1em] text-content-4">
                              Examples
                            </div>
                            <div className="mt-2 flex flex-wrap gap-2">
                              {(examples.length
                                ? examples
                                : ["No examples yet"]
                              ).map((example) => (
                                <Badge
                                  key={example}
                                  variant="outline"
                                  className="bg-surface-2 text-content-2"
                                >
                                  {example}
                                </Badge>
                              ))}
                            </div>
                          </div>
                          <div className="grid gap-4 md:grid-cols-2">
                            <div>
                              <div className="text-[11px] font-semibold uppercase tracking-[0.1em] text-content-4">
                                Needs only config
                              </div>
                              <ul className="mt-2 space-y-1 text-content-2">
                                {(configNeeded.length
                                  ? configNeeded
                                  : ["Nothing extra"]
                                ).map((item) => (
                                  <li key={item}>• {item}</li>
                                ))}
                              </ul>
                            </div>
                            <div>
                              <div className="text-[11px] font-semibold uppercase tracking-[0.1em] text-content-4">
                                Needs code / module
                              </div>
                              <ul className="mt-2 space-y-1 text-content-2">
                                {(codeNeeded.length
                                  ? codeNeeded
                                  : ["No new code needed"]
                                ).map((item) => (
                                  <li key={item}>• {item}</li>
                                ))}
                              </ul>
                            </div>
                          </div>
                          <div>
                            <div className="text-[11px] font-semibold uppercase tracking-[0.1em] text-content-4">
                              Limits
                            </div>
                            <ul className="mt-2 space-y-1 text-content-2">
                              {(limits.length
                                ? limits
                                : ["No explicit limits recorded"]
                              ).map((item) => (
                                <li key={item}>• {item}</li>
                              ))}
                            </ul>
                          </div>
                        </CardContent>
                      </Card>
                    );
                  },
                )}
              </div>
            </div>
          );
        },
      )}
    </div>
  );
}
