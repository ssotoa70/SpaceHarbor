export function StatCard({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-[var(--radius-ah-md)] border border-[var(--color-ah-border-muted)] bg-[var(--color-ah-bg-raised)] px-4 py-3">
      <div className="text-[10px] font-medium tracking-[0.1em] uppercase text-[var(--color-ah-text-subtle)] font-[var(--font-ah-mono)]">
        {label}
      </div>
      <div className="text-lg font-bold font-[var(--font-ah-display)] text-[var(--color-ah-text)] mt-1">
        {value}
      </div>
    </div>
  );
}
