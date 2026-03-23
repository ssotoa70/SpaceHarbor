import type { ConnectionStatus } from "./useEventStream";

const statusConfig: Record<ConnectionStatus, { color: string; label: string }> = {
  connected: { color: "var(--color-ah-success)", label: "Live" },
  reconnecting: { color: "var(--color-ah-warning)", label: "Reconnecting" },
  disconnected: { color: "var(--color-ah-text-subtle)", label: "Offline" },
};

interface ConnectionIndicatorProps {
  status: ConnectionStatus;
}

export function ConnectionIndicator({ status }: ConnectionIndicatorProps) {
  const config = statusConfig[status];
  return (
    <span
      className="inline-flex items-center gap-1.5 text-xs font-medium"
      role="status"
      aria-label={`Connection: ${config.label}`}
    >
      <span className="w-2 h-2 rounded-full" style={{ backgroundColor: config.color }} />
      {config.label}
    </span>
  );
}
