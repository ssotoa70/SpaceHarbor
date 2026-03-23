export interface LineChartSeries {
  label: string;
  data: number[];
  color: string;
}

export function LineChart({
  series,
  width = 400,
  height = 200,
  className = "",
}: {
  series: LineChartSeries[];
  width?: number;
  height?: number;
  className?: string;
}) {
  if (series.length === 0) return null;
  const allValues = series.flatMap((s) => s.data);
  const min = Math.min(...allValues);
  const max = Math.max(...allValues);
  const range = max - min || 1;
  const padding = 4;
  const innerW = width - padding * 2;
  const innerH = height - padding * 2;

  return (
    <svg width={width} height={height} viewBox={`0 0 ${width} ${height}`} className={className}>
      <defs>
        {series.map((s, i) => (
          <linearGradient key={`grad-${i}`} id={`line-grad-${i}`} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={s.color} stopOpacity="0.25" />
            <stop offset="100%" stopColor={s.color} stopOpacity="0.02" />
          </linearGradient>
        ))}
      </defs>
      {series.map((s, i) => {
        if (s.data.length < 2) return null;
        const points = s.data.map((v, j) => {
          const x = padding + (j / (s.data.length - 1)) * innerW;
          const y = padding + innerH - ((v - min) / range) * innerH;
          return `${x},${y}`;
        });
        const polyline = points.join(" ");
        const areaPath = `M${padding},${height - padding} L${points.join(" L")} L${padding + innerW},${height - padding} Z`;

        return (
          <g key={s.label}>
            <path d={areaPath} fill={`url(#line-grad-${i})`} />
            <polyline
              points={polyline}
              fill="none"
              stroke={s.color}
              strokeWidth="2"
              strokeLinejoin="round"
              strokeLinecap="round"
            />
          </g>
        );
      })}
    </svg>
  );
}
