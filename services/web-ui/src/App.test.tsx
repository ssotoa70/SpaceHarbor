import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { App } from "./App";
import type { AssetRow } from "./api";
import { clearGuidedActions } from "./operator/actions";
import type { MetricsSnapshot } from "./operator/types";

function buildAsset(overrides: Partial<AssetRow> = {}): AssetRow {
  return {
    id: "asset-1",
    jobId: "job-1",
    title: "QC Demo Asset",
    sourceUri: "s3://bucket/qc-demo-asset.mov",
    status: "completed",
    ...overrides
  };
}

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
  assets?: AssetRow[];
  metricsSnapshots?: MetricsSnapshot[];
  auditMessages?: string[];
  failAfterRequestCount?: number;
}): void {
  const metricsSnapshots = options?.metricsSnapshots ?? [buildMetricsSnapshot(0)];
  const assets = options?.assets ?? [];
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
        return jsonResponse({ assets });
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

      if (url.endsWith("/api/v1/events")) {
        return new Response(null, { status: 202 });
      }

      return new Response(null, { status: 404 });
    })
  );
}

beforeEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  clearGuidedActions();
  window.localStorage?.clear?.();
  mockApiResponses();
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.unstubAllGlobals();
  clearGuidedActions();
  window.localStorage?.clear?.();
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

  it("persists guided actions in local storage", async () => {
    render(<App />);

    const acknowledgeToggle = await screen.findByRole("checkbox", { name: /acknowledge incident/i });
    const ownerInput = screen.getByRole("textbox", { name: /incident owner/i });
    const escalateToggle = screen.getByRole("checkbox", { name: /escalate response/i });

    fireEvent.click(acknowledgeToggle);
    fireEvent.change(ownerInput, { target: { value: "oncall-ops" } });
    fireEvent.click(escalateToggle);

    cleanup();
    render(<App />);

    expect(await screen.findByRole("checkbox", { name: /acknowledge incident/i })).toBeChecked();
    expect(screen.getByRole("textbox", { name: /incident owner/i })).toHaveValue("oncall-ops");
    expect(screen.getByRole("checkbox", { name: /escalate response/i })).toBeChecked();
    expect(screen.getByText(/local only/i)).toBeInTheDocument();
  });

  it("announces health state updates through a polite live region", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-02-14T10:00:00.000Z"));

    mockApiResponses({
      metricsSnapshots: [buildMetricsSnapshot(0), buildMetricsSnapshot(2)]
    });

    render(<App />);

    await vi.advanceTimersByTimeAsync(15_000);

    const liveRegion = screen.getByRole("status", { name: /health state updates/i });
    expect(liveRegion).toHaveAttribute("aria-live", "polite");
    expect(liveRegion).toHaveTextContent(/health state: degraded/i);
  });

  it("renders explicit text labels for health badges and keeps guided controls keyboard focusable", async () => {
    render(<App />);

    expect(await screen.findByText(/health state:/i)).toBeInTheDocument();

    const clearButton = screen.getByRole("button", { name: /clear guided actions/i });
    clearButton.focus();
    expect(clearButton).toHaveFocus();

    const acknowledgeToggle = screen.getByRole("checkbox", { name: /acknowledge incident/i });
    acknowledgeToggle.focus();
    expect(acknowledgeToggle).toHaveFocus();
  });

  it("renders QC gate actions and submits canonical workflow events", async () => {
    mockApiResponses({
      assets: [
        buildAsset({ id: "asset-completed", jobId: "job-completed", status: "completed", title: "Completed Clip" }),
        buildAsset({ id: "asset-qc-pending", jobId: "job-qc-pending", status: "qc_pending", title: "QC Pending Clip" }),
        buildAsset({ id: "asset-qc-review", jobId: "job-qc-review", status: "qc_in_review", title: "QC Review Clip" }),
        buildAsset({ id: "asset-qc-rejected", jobId: "job-qc-rejected", status: "qc_rejected", title: "QC Rejected Clip" })
      ]
    });

    render(<App />);

    fireEvent.click(await screen.findByRole("button", { name: "Send to QC" }));
    fireEvent.click(screen.getByRole("button", { name: "Start review" }));
    fireEvent.click(screen.getByRole("button", { name: "Approve" }));
    fireEvent.click(screen.getByRole("button", { name: "Reject" }));
    fireEvent.click(screen.getByRole("button", { name: "Mark needs replay" }));

    const eventCalls = vi.mocked(fetch).mock.calls.filter((call) => String(call[0]).endsWith("/api/v1/events"));
    expect(eventCalls.length).toBeGreaterThanOrEqual(5);
  });
});
