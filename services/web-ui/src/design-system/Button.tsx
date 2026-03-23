import type { ButtonHTMLAttributes } from "react";

export type ButtonVariant = "primary" | "secondary" | "ghost" | "destructive";

const variantClasses: Record<ButtonVariant, string> = {
  primary:
    "bg-[var(--color-ah-accent-muted)] text-white border-transparent hover:shadow-[0_0_16px_rgba(34,211,238,0.25)]",
  secondary:
    "bg-[var(--color-ah-bg-raised)] text-[var(--color-ah-text)] border-[var(--color-ah-border)] hover:bg-[var(--color-ah-bg-overlay)]",
  ghost:
    "bg-transparent text-[var(--color-ah-text-muted)] border-transparent hover:bg-[var(--color-ah-bg-raised)] hover:text-[var(--color-ah-text)]",
  destructive:
    "bg-[var(--color-ah-danger-muted)] text-white hover:bg-[var(--color-ah-danger)] border-transparent",
};

const variantStyles: Partial<Record<ButtonVariant, React.CSSProperties>> = {
  primary: { background: "linear-gradient(135deg, var(--color-ah-accent-muted), var(--color-ah-info))" },
};

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
}

export function Button({
  variant = "secondary",
  className = "",
  disabled,
  children,
  ...rest
}: ButtonProps) {
  return (
    <button
      className={`inline-flex items-center justify-center gap-2 px-3 py-1.5 text-sm font-medium rounded-[var(--radius-ah-md)] border cursor-pointer transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--color-ah-accent)] disabled:opacity-50 disabled:cursor-not-allowed ${variantClasses[variant]} ${className}`}
      style={variantStyles[variant]}
      disabled={disabled}
      {...rest}
    >
      {children}
    </button>
  );
}
