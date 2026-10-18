import { ReactNode, HTMLAttributes } from "react";

type CardVariant = "default" | "emphasis" | "hero" | "hero-admin";

interface CardProps extends HTMLAttributes<HTMLDivElement> {
  variant?: CardVariant;
  hoverable?: boolean;
  children: ReactNode;
}

/**
 * Card — the universal surface.
 *
 * <Card>                                — default surface (white, hairline, soft shadow)
 * <Card variant="emphasis">             — same surface with a brand-tinted hairline
 * <Card variant="hero">                 — the page header card (white, dark text)
 * <Card variant="hero-admin">           — identical to "hero"; kept for admin pages
 *
 * Add `hoverable` for a stronger hairline + shadow on hover (not on hero variants).
 *
 * Do NOT use bg-surface-1, border, or shadow utilities — they're baked in.
 */
export function Card({
  variant = "default",
  hoverable = false,
  className = "",
  children,
  ...rest
}: CardProps) {
  const variantClass =
    variant === "emphasis"   ? "is-emphasis"
    : variant === "hero"     ? "is-hero"
    : variant === "hero-admin" ? "is-hero-admin"
    : "";
  const hoverClass = hoverable ? "is-hoverable" : "";
  return (
    <div className={`ds-card ${variantClass} ${hoverClass} ${className}`.trim()} {...rest}>
      {children}
    </div>
  );
}

export default Card;
