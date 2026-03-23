import type { HTMLAttributes, ReactNode } from "react";

interface CardProps extends HTMLAttributes<HTMLDivElement> {
  children: ReactNode;
}

export function Card({ children, className = "", ...rest }: CardProps) {
  return (
    <div
      className={`rounded-[var(--radius-ah-lg)] border border-[var(--color-ah-border)] bg-[var(--color-ah-bg-raised)] p-4 ${className}`}
      {...rest}
    >
      {children}
    </div>
  );
}
