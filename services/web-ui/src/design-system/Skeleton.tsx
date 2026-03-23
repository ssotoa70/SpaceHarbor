import type { HTMLAttributes } from "react";

interface SkeletonProps extends HTMLAttributes<HTMLDivElement> {
  width?: string;
  height?: string;
}

export function Skeleton({ width, height = "1rem", className = "", style, ...rest }: SkeletonProps) {
  return (
    <div
      className={`animate-pulse rounded-[var(--radius-ah-md)] bg-[var(--color-ah-border)] ${className}`}
      style={{ width, height, ...style }}
      aria-hidden="true"
      {...rest}
    />
  );
}
