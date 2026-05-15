import { ButtonHTMLAttributes, ReactNode } from "react";

export type ButtonVariant = "primary" | "secondary" | "ghost" | "success" | "warn" | "danger";
export type ButtonSize = "sm" | "md" | "lg";

interface ButtonProps extends Omit<ButtonHTMLAttributes<HTMLButtonElement>, "children"> {
  variant?: ButtonVariant;
  size?: ButtonSize;
  children: ReactNode;
  iconLeft?: ReactNode;
  iconRight?: ReactNode;
}

/**
 * Button — five variants, three sizes.
 *
 * <Button>Default primary</Button>
 * <Button variant="secondary" size="sm">Small secondary</Button>
 * <Button variant="ghost">Ghost</Button>
 * <Button variant="success" iconRight="→">Approve</Button>
 *
 * Disabled state is automatic via the disabled attribute. Focus ring is automatic.
 */
export function Button({
  variant = "primary",
  size = "md",
  children,
  iconLeft,
  iconRight,
  className = "",
  ...rest
}: ButtonProps) {
  const variantClass = `is-${variant}`;
  const sizeClass = size !== "md" ? `size-${size}` : "";
  return (
    <button className={`ds-btn ${variantClass} ${sizeClass} ${className}`.trim()} {...rest}>
      {iconLeft}
      {children}
      {iconRight}
    </button>
  );
}

export default Button;
