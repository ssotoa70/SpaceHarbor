import { formatHours } from "./utils";

export interface VerticalBarChartProps {
  data: Array<{ label: string; value: number; color?: string }>;
}

export function VerticalBarChart({ data }: VerticalBarChartProps) {
  const maxValue = Math.max(...data.map((d) => d.value), 1);

  return (
    <div className="flex items-end gap-3 h-[180px] pt-2">
      {data.map((d) => {
        const heightPct = (d.value / maxValue) * 100;
        const color = d.color ?? "var(--color-ah-accent-muted)";
        return (
          <div key={d.label} className="flex-1 flex flex-col items-center gap-1.5 h-full justify-end">
            <span className="text-[10px] font-[var(--font-ah-mono)] text-[var(--color-ah-text-muted)]">
              {formatHours(d.value)}h
            </span>
            <div className="w-full relative flex items-end" style={{ height: "calc(100% - 36px)" }}>
              <div
                className="w-full rounded-t-[3px] transition-all duration-300"
                style={{
                  height: `${heightPct}%`,
                  backgroundColor: color,
                  opacity: 0.85,
                  minHeight: "4px",
                }}
                role="img"
                aria-label={`${d.label}: ${d.value}`}
              />
            </div>
            <span className="text-[10px] font-[var(--font-ah-mono)] text-[var(--color-ah-text-subtle)] truncate max-w-full">
              {d.label}
            </span>
          </div>
        );
      })}
    </div>
  );
}
