import { render, screen, fireEvent } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { TriggersTab } from "./TriggersTab";
import type { VastTrigger } from "../../types/dataengine";

/* ── Mock data ── */

const MOCK_TRIGGERS: VastTrigger[] = [
  {
    guid: "t-001",
    name: "ingest-watcher",
    description: "Watch for new EXR uploads",
    type: "element",
    status: "active",
    source_view: "media-ingest",
    event_type: "ElementCreated",
    target_event_broker_view: "broker-1",
    topic: "events.ingest",
    prefix_filter: "/data/",
    suffix_filter: ".exr",
    custom_extensions: {},
    tags: {},
    created_at: "2026-03-15T10:00:00Z",
    vrn: "vrn:vast:trigger:t-001",
  },
  {
    guid: "t-002",
    name: "nightly-cleanup",
    description: "Scheduled cleanup job",
    type: "schedule",
    status: "active",
    kafka_view: "kafka-main",
    topic: "jobs.cleanup",
    schedule_expression: "0 0 2 * * ?",
    custom_extensions: {},
    tags: {},
    created_at: "2026-03-20T08:30:00Z",
    vrn: "vrn:vast:trigger:t-002",
  },
];

/* ── Mocks ── */

const mockFetchVastTriggers = vi.fn<() => Promise<VastTrigger[]>>();
const mockDeleteVastTrigger = vi.fn<(guid: string) => Promise<void>>();
const mockCreateVastTrigger = vi.fn();

vi.mock("../../api/dataengine-proxy", () => ({
  fetchVastTriggers: (...args: unknown[]) => mockFetchVastTriggers(...(args as [])),
  deleteVastTrigger: (...args: unknown[]) => mockDeleteVastTrigger(...(args as [string])),
  createVastTrigger: (...args: unknown[]) => mockCreateVastTrigger(...args),
}));

/* ── Tests ── */

describe("TriggersTab", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockFetchVastTriggers.mockResolvedValue(MOCK_TRIGGERS);
    mockDeleteVastTrigger.mockResolvedValue(undefined);
    mockCreateVastTrigger.mockResolvedValue(MOCK_TRIGGERS[0]);
  });

  it("renders loading skeleton initially", () => {
    // Keep the promise pending
    mockFetchVastTriggers.mockReturnValue(new Promise(() => {}));
    render(<TriggersTab />);
    expect(screen.getByTestId("triggers-loading")).toBeDefined();
  });

  it("shows triggers table after data loads", async () => {
    render(<TriggersTab />);
    await vi.waitFor(() => {
      expect(screen.getByTestId("triggers-table")).toBeDefined();
    });
    expect(screen.getByText("ingest-watcher")).toBeDefined();
    expect(screen.getByText("nightly-cleanup")).toBeDefined();
  });

  it("shows both element and schedule trigger types with correct badges", async () => {
    render(<TriggersTab />);
    await vi.waitFor(() => {
      expect(screen.getByTestId("triggers-table")).toBeDefined();
    });
    expect(screen.getByText("Element")).toBeDefined();
    expect(screen.getByText("Schedule")).toBeDefined();
  });

  it("shows empty state when no triggers", async () => {
    mockFetchVastTriggers.mockResolvedValue([]);
    render(<TriggersTab />);
    await vi.waitFor(() => {
      expect(screen.getByTestId("triggers-empty")).toBeDefined();
    });
    expect(screen.getByText("No triggers found")).toBeDefined();
  });

  it("shows error state with retry button", async () => {
    mockFetchVastTriggers.mockRejectedValue(new Error("Network error"));
    render(<TriggersTab />);
    await vi.waitFor(() => {
      expect(screen.getByTestId("triggers-error")).toBeDefined();
    });
    expect(screen.getByText("Network error")).toBeDefined();
    expect(screen.getByTestId("triggers-retry")).toBeDefined();
  });

  it("retry button re-fetches triggers", async () => {
    mockFetchVastTriggers.mockRejectedValueOnce(new Error("fail"));
    render(<TriggersTab />);
    await vi.waitFor(() => {
      expect(screen.getByTestId("triggers-error")).toBeDefined();
    });

    mockFetchVastTriggers.mockResolvedValueOnce(MOCK_TRIGGERS);
    fireEvent.click(screen.getByTestId("triggers-retry"));
    await vi.waitFor(() => {
      expect(screen.getByTestId("triggers-table")).toBeDefined();
    });
    expect(mockFetchVastTriggers).toHaveBeenCalledTimes(2);
  });

  it("create modal opens on button click", async () => {
    render(<TriggersTab />);
    await vi.waitFor(() => {
      expect(screen.getByTestId("triggers-table")).toBeDefined();
    });

    fireEvent.click(screen.getByTestId("triggers-create-btn"));
    expect(screen.getByTestId("trigger-create-modal")).toBeDefined();
  });

  it("type toggle switches between element and schedule fields", async () => {
    render(<TriggersTab />);
    await vi.waitFor(() => {
      expect(screen.getByTestId("triggers-table")).toBeDefined();
    });

    fireEvent.click(screen.getByTestId("triggers-create-btn"));
    expect(screen.getByTestId("trigger-create-modal")).toBeDefined();

    // Default is element
    expect(screen.getByTestId("trigger-element-fields")).toBeDefined();
    expect(screen.queryByTestId("trigger-schedule-fields")).toBeNull();

    // Switch to schedule
    fireEvent.click(screen.getByTestId("trigger-type-schedule"));
    expect(screen.getByTestId("trigger-schedule-fields")).toBeDefined();
    expect(screen.queryByTestId("trigger-element-fields")).toBeNull();

    // Switch back to element
    fireEvent.click(screen.getByTestId("trigger-type-element"));
    expect(screen.getByTestId("trigger-element-fields")).toBeDefined();
    expect(screen.queryByTestId("trigger-schedule-fields")).toBeNull();
  });

  it("shows source view for element triggers and schedule expression for schedule triggers", async () => {
    render(<TriggersTab />);
    await vi.waitFor(() => {
      expect(screen.getByTestId("triggers-table")).toBeDefined();
    });
    // Element trigger shows source_view
    expect(screen.getByText("media-ingest")).toBeDefined();
    // Schedule trigger shows schedule_expression
    expect(screen.getByText("0 0 2 * * ?")).toBeDefined();
  });

  it("shows inline delete confirmation", async () => {
    render(<TriggersTab />);
    await vi.waitFor(() => {
      expect(screen.getByTestId("triggers-table")).toBeDefined();
    });

    fireEvent.click(screen.getByTestId("trigger-delete-t-001"));
    expect(screen.getByTestId("trigger-confirm-delete-t-001")).toBeDefined();
    expect(screen.getByText("Delete?")).toBeDefined();
  });

  it("cancels delete confirmation", async () => {
    render(<TriggersTab />);
    await vi.waitFor(() => {
      expect(screen.getByTestId("triggers-table")).toBeDefined();
    });

    fireEvent.click(screen.getByTestId("trigger-delete-t-001"));
    fireEvent.click(screen.getByTestId("trigger-cancel-delete-t-001"));
    // Should go back to showing delete button
    expect(screen.getByTestId("trigger-delete-t-001")).toBeDefined();
  });

  it("closes modal on backdrop click", async () => {
    render(<TriggersTab />);
    await vi.waitFor(() => {
      expect(screen.getByTestId("triggers-table")).toBeDefined();
    });

    fireEvent.click(screen.getByTestId("triggers-create-btn"));
    expect(screen.getByTestId("trigger-create-modal")).toBeDefined();

    fireEvent.click(screen.getByTestId("trigger-modal-backdrop"));
    expect(screen.queryByTestId("trigger-create-modal")).toBeNull();
  });
});
