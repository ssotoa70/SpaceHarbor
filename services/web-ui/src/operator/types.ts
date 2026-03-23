export interface MetricsSnapshot {
  assets: {
    total: number;
  };
  jobs: {
    total: number;
    pending: number;
    processing: number;
    completed: number;
    failed: number;
    needsReplay: number;
  };
  queue: {
    pending: number;
    leased: number;
  };
  outbox: {
    pending: number;
    published: number;
  };
  dlq: {
    total: number;
  };
  degradedMode: {
    fallbackEvents: number;
  };
}
