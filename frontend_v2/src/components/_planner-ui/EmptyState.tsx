import { ReactNode } from "react";

interface EmptyStateProps {
  icon?: ReactNode;          // a small icon (e.g. <Inbox className="w-7 h-7" />)
  title: string;
  body?: string;
  cta?: ReactNode;           // a Button (or two)
  className?: string;
}

/**
 * EmptyState — for tables/lists with zero rows, dashboards before first run, etc.
 *
 * <EmptyState
 *   icon={<Inbox className="w-7 h-7" />}
 *   title="No stock orders yet"
 *   body="When planners launch a recipe, the order shows up here."
 *   cta={<Button>+ Create stock order</Button>}
 * />
 */
export function EmptyState({ icon, title, body, cta, className = "" }: EmptyStateProps) {
  return (
    <div className={`ds-empty ${className}`.trim()}>
      {icon && <div className="ds-empty-icon">{icon}</div>}
      <div className="ds-empty-title">{title}</div>
      {body && <div className="ds-empty-body">{body}</div>}
      {cta && <div>{cta}</div>}
    </div>
  );
}

export default EmptyState;
