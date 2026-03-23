export interface HorizontalBarChartProps {
  data: Array<{ label: string; value: number; sublabel?: string; color?: string }>;
}

export function HorizontalBarChart({ data }: HorizontalBarChartProps) {
  const maxValue = Math.max(...data.map((d) => d.value), 1);

  return (
    <div className="space-y-3">
      {data.map((d, i) => {
        const widthPct = (d.value / maxValue) * 100;
        const color = d.color ?? "var(--color-ah-accent-muted)";
        return (
          <div key={`${d.label}-${i}`} className="space-y-1">
            <div className="flex justify-between items-center">
              <span className="text-xs font-[var(--font-ah-mono)] text-[var(--color-ah-text-muted)]">
                {d.label}
              </span>
              {d.sublabel && (
                <span className="text-xs font-[var(--font-ah-mono)] text-[var(--color-ah-text-subtle)]">
                  {d.sublabel}
                </span>
              )}
            </div>
            <div className="h-3 rounded-full bg-[var(--color-ah-bg-overlay)] overflow-hidden">
              <div
                className="h-full rounded-full transition-all duration-300"
                style={{
                  width: `${widthPct}%`,
                  backgroundColor: color,
                  opacity: 0.8,
                }}
                role="img"
                aria-label={`${d.label}: ${d.value}`}
              />
            </div>
          </div>
        );
      })}
    </div>
  );
}
