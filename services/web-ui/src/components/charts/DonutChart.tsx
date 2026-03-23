export interface DonutSegment {
  label: string;
  value: number;
  color: string;
}

export function DonutChart({
  segments,
  size = 160,
  strokeWidth = 24,
  className = "",
}: {
  segments: DonutSegment[];
  size?: number;
  strokeWidth?: number;
  className?: string;
}) {
  const total = segments.reduce((sum, s) => sum + s.value, 0);
  if (total === 0) return null;
  const radius = (size - strokeWidth) / 2;
  const circumference = 2 * Math.PI * radius;
  const center = size / 2;

  let cumulativeOffset = 0;

  return (
    <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} className={className}>
      {segments.map((seg) => {
        const pct = seg.value / total;
        const dashLength = pct * circumference;
        const dashOffset = -cumulativeOffset;
        cumulativeOffset += dashLength;
        return (
          <circle
            key={seg.label}
            cx={center}
            cy={center}
            r={radius}
            fill="none"
            stroke={seg.color}
            strokeWidth={strokeWidth}
            strokeDasharray={`${dashLength} ${circumference - dashLength}`}
            strokeDashoffset={dashOffset}
            transform={`rotate(-90 ${center} ${center})`}
            role="img"
            aria-label={`${seg.label}: ${(pct * 100).toFixed(1)}%`}
          />
        );
      })}
    </svg>
  );
}
