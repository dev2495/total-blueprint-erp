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
 * <Card>                                — default surface
 * <Card variant="emphasis">             — top-tinted gradient, slightly elevated
 * <Card variant="hero">                 — brand blue gradient, white text
 * <Card variant="hero-admin">           — navy gradient, for admin pages
 *
 * Add `hoverable` to lift on hover (do not use on hero variants).
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
