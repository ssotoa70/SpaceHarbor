import { Skeleton } from "../design-system";

export function PageSkeleton() {
  return (
    <div className="p-6 space-y-4" role="status" aria-label="Loading page">
      <Skeleton height="32px" width="200px" />
      <Skeleton height="48px" />
      <div className="grid grid-cols-4 gap-4">
        {Array.from({ length: 8 }).map((_, i) => (
          <Skeleton key={i} height="180px" />
        ))}
      </div>
    </div>
  );
}
