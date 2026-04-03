import { cleanup, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { TelemetryTrace, TraceSpan, TelemetryLog } from "../../types/dataengine";

// Mock the API module
vi.mock("../../api/dataengine-proxy");

// Import after mock so we get the mocked versions
import * as api from "../../api/dataengine-proxy";
import { TelemetryTab } from "./TelemetryTab";

const SAMPLE_TRACES: TelemetryTrace[] = [
  {
    trace_id: "abc123def456789012345678",
    pipeline: "ingest-pipeline",
    status: "ok",
    duration_ms: 1250,
    start_time: "2026-04-01T10:30:00Z",
  },
  {
    trace_id: "xyz789ghi012345678901234",
    pipeline: "transcode-pipeline",
    status: "error",
    duration_ms: 450,
    start_time: "2026-04-01T10:31:00Z",
  },
];

const SAMPLE_SPANS: TraceSpan[] = [
  {
    span_id: "span-001",
    parent_span_id: null,
    operation_name: "pipeline.execute",
    service_name: "dataengine-runtime",
    status: "ok",
    duration_ms: 1250,
    started_at: "2026-04-01T10:30:00Z",
    attributes: { "pipeline.name": "ingest-pipeline" },
    children: [
      {
        span_id: "span-002",
        parent_span_id: "span-001",
        operation_name: "function.thumbnail",
        service_name: "thumbnail-gen",
        status: "ok",
        duration_ms: 800,
        started_at: "2026-04-01T10:30:00.200Z",
        attributes: {},
        children: [],
      },
    ],
  },
];

const SAMPLE_LOGS: TelemetryLog[] = [
  {
    timestamp: "2026-04-01T10:30:01Z",
    level: "INFO",
    scope: "user",
    pipeline: "ingest-pipeline",
    message: "Pipeline execution started",
    trace_id: "abc123def456789012345678",
  },
  {
    timestamp: "2026-04-01T10:30:02Z",
    level: "ERROR",
    scope: "vast-runtime",
    pipeline: "ingest-pipeline",
    message: "Connection timeout to storage backend",
    trace_id: "abc123def456789012345678",
  },
  {
    timestamp: "2026-04-01T10:30:03Z",
    level: "WARN",
    scope: "user",
    pipeline: "ingest-pipeline",
    message: "Retrying with exponential backoff",
    trace_id: "abc123def456789012345678",
  },
];

describe("TelemetryTab", () => {
  beforeEach(() => {
    vi.mocked(api.fetchTraces).mockResolvedValue(SAMPLE_TRACES);
    vi.mocked(api.fetchTraceTree).mockResolvedValue(SAMPLE_SPANS);
    vi.mocked(api.fetchLogs).mockResolvedValue(SAMPLE_LOGS);
    vi.mocked(api.fetchSpanLogs).mockResolvedValue([]);
  });

  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  it("renders loading skeleton initially", () => {
    vi.mocked(api.fetchTraces).mockReturnValue(new Promise(() => {}));

    render(<TelemetryTab />);

    expect(screen.getByTestId("telemetry-loading")).toBeInTheDocument();
  });

  it("shows traces table after data loads", async () => {
    render(<TelemetryTab />);

    await waitFor(() => {
      expect(screen.getByTestId("traces-table")).toBeInTheDocument();
    });

    expect(screen.getByText("ingest-pipeline")).toBeInTheDocument();
    expect(screen.getByText("transcode-pipeline")).toBeInTheDocument();
  });

  it("shows empty state when no traces", async () => {
    vi.mocked(api.fetchTraces).mockResolvedValue([]);

    render(<TelemetryTab />);

    await waitFor(() => {
      expect(screen.getByTestId("telemetry-empty")).toBeInTheDocument();
    });

    expect(screen.getByText("No traces found")).toBeInTheDocument();
  });

  it("shows error state with retry", async () => {
    vi.mocked(api.fetchTraces).mockRejectedValue(new Error("Connection refused"));

    render(<TelemetryTab />);

    await waitFor(() => {
      expect(screen.getByTestId("telemetry-error")).toBeInTheDocument();
    });

    expect(screen.getByText("Connection refused")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Retry" })).toBeInTheDocument();

    // Click retry
    vi.mocked(api.fetchTraces).mockResolvedValue(SAMPLE_TRACES);
    await userEvent.click(screen.getByRole("button", { name: "Retry" }));

    await waitFor(() => {
      expect(screen.getByTestId("traces-table")).toBeInTheDocument();
    });
  });

  it("clicking a trace shows the detail panel", async () => {
    render(<TelemetryTab />);

    await waitFor(() => {
      expect(screen.getByTestId("traces-table")).toBeInTheDocument();
    });

    // Click first trace row
    const row = screen.getByTestId("trace-row-abc123def456789012345678");
    await userEvent.click(row);

    await waitFor(() => {
      expect(screen.getByTestId("trace-detail-panel")).toBeInTheDocument();
    });

    // Should show spans and logs sub-tabs
    expect(screen.getByTestId("subtab-spans")).toBeInTheDocument();
    expect(screen.getByTestId("subtab-logs")).toBeInTheDocument();

    // Should have called fetchTraceTree
    expect(api.fetchTraceTree).toHaveBeenCalledWith("abc123def456789012345678");
  });

  it("detail panel shows Spans and Logs sub-tabs", async () => {
    render(<TelemetryTab />);

    await waitFor(() => {
      expect(screen.getByTestId("traces-table")).toBeInTheDocument();
    });

    await userEvent.click(screen.getByTestId("trace-row-abc123def456789012345678"));

    await waitFor(() => {
      expect(screen.getByTestId("trace-detail-panel")).toBeInTheDocument();
    });

    // Click Logs sub-tab
    await userEvent.click(screen.getByTestId("subtab-logs"));

    await waitFor(() => {
      expect(screen.getByTestId("logs-table")).toBeInTheDocument();
    });

    expect(api.fetchLogs).toHaveBeenCalledWith({ trace_id: "abc123def456789012345678" });
  });

  it("filter inputs are rendered (pipeline, status, time range)", async () => {
    render(<TelemetryTab />);

    await waitFor(() => {
      expect(screen.getByTestId("telemetry-filters")).toBeInTheDocument();
    });

    expect(screen.getByTestId("filter-pipeline")).toBeInTheDocument();
    expect(screen.getByTestId("filter-status")).toBeInTheDocument();
    expect(screen.getByTestId("filter-time-range")).toBeInTheDocument();
  });

  it("TraceTreeViewer renders span names", async () => {
    render(<TelemetryTab />);

    await waitFor(() => {
      expect(screen.getByTestId("traces-table")).toBeInTheDocument();
    });

    await userEvent.click(screen.getByTestId("trace-row-abc123def456789012345678"));

    await waitFor(() => {
      expect(screen.getByTestId("trace-tree-viewer")).toBeInTheDocument();
    });

    expect(screen.getByText("pipeline.execute")).toBeInTheDocument();
    expect(screen.getByText("function.thumbnail")).toBeInTheDocument();
  });

  it("log level badges have correct variants", async () => {
    render(<TelemetryTab />);

    await waitFor(() => {
      expect(screen.getByTestId("traces-table")).toBeInTheDocument();
    });

    await userEvent.click(screen.getByTestId("trace-row-abc123def456789012345678"));

    await waitFor(() => {
      expect(screen.getByTestId("trace-detail-panel")).toBeInTheDocument();
    });

    // Switch to logs tab
    await userEvent.click(screen.getByTestId("subtab-logs"));

    await waitFor(() => {
      expect(screen.getByTestId("logs-table")).toBeInTheDocument();
    });

    // INFO, ERROR, and WARN badges should be present
    const logsTable = screen.getByTestId("logs-table");
    expect(within(logsTable).getByText("INFO")).toBeInTheDocument();
    expect(within(logsTable).getByText("ERROR")).toBeInTheDocument();
    expect(within(logsTable).getByText("WARN")).toBeInTheDocument();
  });

  it("closes detail panel when Close button is clicked", async () => {
    render(<TelemetryTab />);

    await waitFor(() => {
      expect(screen.getByTestId("traces-table")).toBeInTheDocument();
    });

    await userEvent.click(screen.getByTestId("trace-row-abc123def456789012345678"));

    await waitFor(() => {
      expect(screen.getByTestId("trace-detail-panel")).toBeInTheDocument();
    });

    await userEvent.click(screen.getByTestId("close-detail"));

    expect(screen.queryByTestId("trace-detail-panel")).not.toBeInTheDocument();
  });
});
