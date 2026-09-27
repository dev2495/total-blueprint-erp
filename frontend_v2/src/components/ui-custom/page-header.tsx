import { cn } from "@/lib/utils";
import { PageHero } from "@/components/premium/page-hero";
import type { LocalizedText } from "@/help/types";
import { PageHelpInline } from "@/components/help/page-help-inline";

interface PageHeaderProps {
  title: string;
  description?: string;
  actions?: React.ReactNode;
  className?: string;
  helpRoute?: string;
  helpSummary?: LocalizedText | string;
  showHelpInline?: boolean;
}

export function PageHeader({
  title,
  description,
  actions,
  className,
  helpRoute,
  helpSummary,
  showHelpInline,
}: PageHeaderProps) {
  return (
    <div className={cn("space-y-3 pb-4", className)}>
      <PageHero compact title={title} description={description} actions={actions} />
      <div className="px-1">
        {showHelpInline ? (
          <PageHelpInline
            routePattern={helpRoute}
            helpSummary={helpSummary}
            compact
          />
        ) : null}
      </div>
    </div>
  );
}
