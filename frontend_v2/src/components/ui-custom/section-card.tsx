import { cn } from "@/lib/utils";

interface SectionCardProps extends React.HTMLAttributes<HTMLDivElement> {
  title?: string;
  description?: string;
  action?: React.ReactNode;
}

export function SectionCard({
  title,
  description,
  action,
  children,
  className,
  ...props
}: SectionCardProps) {
  return (
    <div
      className={cn(
        "rounded-[18px] border border-line bg-surface-1 text-card-foreground shadow-[var(--shadow-sm)]",
        className,
      )}
      {...props}
    >
      {(title || description || action) && (
        <div className="flex items-start justify-between gap-3 px-5 pb-3 pt-4">
          <div className="space-y-1">
            {title && (
              <h3 className="text-[14.5px] font-semibold tracking-[-0.01em] text-content-1">
                {title}
              </h3>
            )}
            {description && (
              <p className="text-[12.5px] leading-relaxed text-content-3">{description}</p>
            )}
          </div>
          {action && <div>{action}</div>}
        </div>
      )}
      <div
        className={cn("px-5 pb-5", {
          "pt-5": !title && !description && !action,
        })}
      >
        {children}
      </div>
    </div>
  );
}
