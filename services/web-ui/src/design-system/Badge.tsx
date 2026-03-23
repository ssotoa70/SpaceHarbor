import type { HTMLAttributes } from "react";

export type BadgeVariant = "default" | "success" | "warning" | "danger" | "info" | "purple" | "orange";

const variantClasses: Record<BadgeVariant, string> = {
  default:
    "bg-[var(--color-ah-bg-overlay)] text-[var(--color-ah-text-muted)] border-[var(--color-ah-border)]",
  success:
    "bg-[var(--color-ah-success-muted)]/20 text-[var(--color-ah-success)] border-[var(--color-ah-success-muted)]",
  warning:
    "bg-[var(--color-ah-warning-muted)]/20 text-[var(--color-ah-warning)] border-[var(--color-ah-warning-muted)]",
  danger:
    "bg-[var(--color-ah-danger-muted)]/20 text-[var(--color-ah-danger)] border-[var(--color-ah-danger-muted)]",
  info:
    "bg-[var(--color-ah-accent-muted)]/20 text-[var(--color-ah-accent)] border-[var(--color-ah-accent-muted)]",
  purple:
    "bg-[var(--color-ah-purple)]/12 text-[var(--color-ah-purple)] border-[var(--color-ah-purple)]/25",
  orange:
    "bg-[var(--color-ah-orange)]/12 text-[var(--color-ah-orange)] border-[var(--color-ah-orange)]/25",
};

interface BadgeProps extends HTMLAttributes<HTMLSpanElement> {
  variant?: BadgeVariant;
}

export function Badge({ variant = "default", className = "", children, ...rest }: BadgeProps) {
  return (
    <span
      className={`inline-flex items-center rounded-[var(--radius-ah-full)] border px-2 py-0.5 text-xs font-semibold ${variantClasses[variant]} ${className}`}
      {...rest}
    >
      {children}
    </span>
  );
}
