import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { App } from "./App";
import type { MetricsSnapshot } from "./operator/types";

function buildMetricsSnapshot(fallbackEvents: number): MetricsSnapshot {
  return {
    assets: {
      total: 4
    },
    jobs: {
      total: 4,
      pending: 1,
      processing: 1,
      completed: 1,
      failed: 1,
      needsReplay: 0
    },
    queue: {
      pending: 2,
      leased: 1
    },
    outbox: {
      pending: 1,
      published: 10
    },
    dlq: {
      total: 0
    },
    degradedMode: {
      fallbackEvents
    }
  };
}

function jsonResponse(body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: {
      "content-type": "application/json"
    }
  });
}

function mockApiResponses(options?: {
  metricsSnapshots?: MetricsSnapshot[];
  auditMessages?: string[];
  failAfterRequestCount?: number;
}): void {
  const metricsSnapshots = options?.metricsSnapshots ?? [buildMetricsSnapshot(0)];
  const auditRows = (options?.auditMessages ?? []).map((message, index) => ({
    id: `audit-${index}`,
    message,
    at: new Date().toISOString()
  }));

  let requestCount = 0;
  let metricsIndex = 0;

  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: RequestInfo | URL) => {
      requestCount += 1;

      if (options?.failAfterRequestCount !== undefined && requestCount > options.failAfterRequestCount) {
        throw new Error("network unavailable");
      }

      const url = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;

      if (url.endsWith("/api/v1/assets")) {
        return jsonResponse({ assets: [] });
      }

      if (url.endsWith("/api/v1/audit")) {
        return jsonResponse({ events: auditRows });
      }

      if (url.endsWith("/api/v1/metrics")) {
        const snapshot = metricsSnapshots[Math.min(metricsIndex, metricsSnapshots.length - 1)];
        metricsIndex += 1;
        return jsonResponse(snapshot);
      }

      if (url.endsWith("/api/v1/assets/ingest")) {
        return new Response(null, { status: 201 });
      }

      if (/\/api\/v1\/jobs\/.+\/replay$/.test(url)) {
        return new Response(null, { status: 202 });
      }

      return new Response(null, { status: 404 });
    })
  );
}

beforeEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  mockApiResponses();
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe("App", () => {
  it("renders queue-first workspace elements", () => {
    render(<App />);

    expect(screen.getByRole("heading", { name: "Assets Queue" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Ingest" })).toBeInTheDocument();
    expect(screen.getByRole("columnheader", { name: "Status" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Recent Audit" })).toBeInTheDocument();
  });

  it("renders operational health section", async () => {
    render(<App />);

    expect(await screen.findByRole("heading", { name: /operational health/i })).toBeInTheDocument();
  });

  it("shows degraded health state when fallback events increase", async () => {
    mockApiResponses({
      metricsSnapshots: [buildMetricsSnapshot(3)]
    });

    render(<App />);

    expect(await screen.findByText(/degraded/i)).toBeInTheDocument();
  });

  it("shows stale marker when health data is outdated", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-02-14T10:00:00.000Z"));

    mockApiResponses({
      metricsSnapshots: [buildMetricsSnapshot(0)],
      failAfterRequestCount: 3
    });

    render(<App />);

    vi.setSystemTime(new Date("2026-02-14T10:01:30.000Z"));
    await vi.advanceTimersByTimeAsync(90_000);

    expect(screen.getByText(/stale/i)).toBeInTheDocument();
  });

  it("shows fallback impact count and trend", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-02-14T10:00:00.000Z"));

    mockApiResponses({
      metricsSnapshots: [buildMetricsSnapshot(1), buildMetricsSnapshot(4)]
    });

    render(<App />);

    await vi.advanceTimersByTimeAsync(15_000);

    expect(screen.getByText(/fallback events/i)).toBeInTheDocument();
    expect(screen.getByText(/rising|stable|falling/i)).toBeInTheDocument();
  });

  it("highlights fallback-correlated audit events", async () => {
    mockApiResponses({
      auditMessages: ["vast fallback triggered for createIngestAsset"]
    });

    render(<App />);

    const fallbackMessage = await screen.findByText(/vast fallback/i);
    expect(fallbackMessage).toBeInTheDocument();
    expect(fallbackMessage.closest("li")).toHaveClass("timeline-fallback");
  });
});
