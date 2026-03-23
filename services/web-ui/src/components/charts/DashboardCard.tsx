export function DashboardCard({
  title,
  children,
  className = "",
}: {
  title: string;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <div
      className={`rounded-[var(--radius-ah-lg)] border border-[var(--color-ah-border-muted)] bg-[var(--color-ah-bg-raised)] p-5 ${className}`}
    >
      <h3 className="text-xs font-medium tracking-[0.1em] uppercase text-[var(--color-ah-text-subtle)] mb-4 font-[var(--font-ah-mono)]">
        {title}
      </h3>
      {children}
    </div>
  );
}
