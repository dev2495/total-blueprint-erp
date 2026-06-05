"use client";

import type { LucideIcon } from "lucide-react";

import { FactoryPageLayout } from "@/components/factory/FactoryPageLayout";
import { Card, CardContent } from "@/components/ui/card";
import { SummaryStatCard } from "@/components/ui-custom/summary-stat-card";
import { SemanticBadge } from "@/components/ui-custom/semantic-badge";
import type { SemanticKind } from "@/lib/visual-semantics";

interface RegistryStat {
  label: string;
  value: string | number;
  subLabel?: string;
  icon: LucideIcon;
  toneClassName?: string;
}

interface MasterRegistryShellProps {
  title: string;
  description: string;
  searchQuery?: string;
  onSearchChange?: (query: string) => void;
  searchPlaceholder?: string;
  actions?: React.ReactNode;
  stats?: RegistryStat[];
  chips?: Array<{ kind?: SemanticKind; value: string; label?: string }>;
  children: React.ReactNode;
}

export function MasterRegistryShell({
  title,
  description,
  searchQuery,
  onSearchChange,
  searchPlaceholder,
  actions,
  stats = [],
  chips = [],
  children,
}: MasterRegistryShellProps) {
  return (
    <FactoryPageLayout
      title={title}
      description={description}
      searchQuery={searchQuery}
      onSearchChange={onSearchChange}
      searchPlaceholder={searchPlaceholder}
      actions={actions}
    >
      {stats.length > 0 ? (
        <div className="mb-6 grid gap-4 md:grid-cols-2 xl:grid-cols-4">
          {stats.map((stat) => (
            <SummaryStatCard
              key={stat.label}
              label={stat.label}
              value={stat.value}
              subLabel={stat.subLabel}
              icon={stat.icon}
              toneClassName={stat.toneClassName}
            />
          ))}
        </div>
      ) : null}

      {chips.length > 0 ? (
        <Card className="mb-6 border-0 shadow-sm ring-1 ring-line">
          <CardContent className="flex flex-wrap items-center gap-2 p-4">
            {chips.map((chip) => (
              <SemanticBadge
                key={`${chip.kind || "status"}-${chip.value}-${chip.label || ""}`}
                kind={chip.kind}
                value={chip.value}
                label={chip.label}
              />
            ))}
          </CardContent>
        </Card>
      ) : null}

      {children}
    </FactoryPageLayout>
  );
}
