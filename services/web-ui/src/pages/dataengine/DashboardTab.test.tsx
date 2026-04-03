import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { DashboardTab } from "./DashboardTab";

const mockStats = {
  functions_count: 12,
  triggers_count: 5,
  pipelines_count: 8,
  active_pipelines: 3,
};

const mockEventsStats = {
  labels: ["Mon", "Tue", "Wed", "Thu", "Fri"],
  events: [120, 150, 130, 170, 160],
  failures: [2, 5, 1, 3, 4],
};

const mockExecutionTime = {
  labels: ["exr-to-proxy", "ffmpeg-transcode", "metadata-extract"],
  avg_duration_ms: [4500, 12000, 800],
};

vi.mock("../../api/dataengine-proxy", () => ({
  fetchDashboardStats: vi.fn(),
  fetchDashboardEventsStats: vi.fn(),
  fetchDashboardExecutionTime: vi.fn(),
}));

async function getApiMock() {
  return await import("../../api/dataengine-proxy");
}

function mockAllSuccess() {
  return getApiMock().then((api) => {
    (api.fetchDashboardStats as ReturnType<typeof vi.fn>).mockResolvedValue(mockStats);
    (api.fetchDashboardEventsStats as ReturnType<typeof vi.fn>).mockResolvedValue(mockEventsStats);
    (api.fetchDashboardExecutionTime as ReturnType<typeof vi.fn>).mockResolvedValue(mockExecutionTime);
  });
}

function mockAllFailure() {
  return getApiMock().then((api) => {
    const err = new Error("Connection refused");
    (api.fetchDashboardStats as ReturnType<typeof vi.fn>).mockRejectedValue(err);
    (api.fetchDashboardEventsStats as ReturnType<typeof vi.fn>).mockRejectedValue(err);
    (api.fetchDashboardExecutionTime as ReturnType<typeof vi.fn>).mockRejectedValue(err);
  });
}

describe("DashboardTab", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("renders loading skeleton initially", async () => {
    await mockAllSuccess();
    render(<DashboardTab />);
    expect(screen.getByTestId("dashboard-skeleton")).toBeDefined();
    expect(screen.getByText("DataEngine Overview")).toBeDefined();
  });

  it("shows stat cards after data loads", async () => {
    await mockAllSuccess();
    render(<DashboardTab />);

    await vi.waitFor(() => {
      expect(screen.getByText("Functions")).toBeDefined();
      expect(screen.getByText("12")).toBeDefined();
      expect(screen.getByText("Triggers")).toBeDefined();
      expect(screen.getByText("5")).toBeDefined();
      expect(screen.getByText("Pipelines Total")).toBeDefined();
      expect(screen.getByText("8")).toBeDefined();
      expect(screen.getByText("Pipelines Active")).toBeDefined();
      expect(screen.getByText("3")).toBeDefined();
    });
  });

  it("shows chart containers after data loads", async () => {
    await mockAllSuccess();
    render(<DashboardTab />);

    await vi.waitFor(() => {
      expect(screen.getByText("Events & Failures")).toBeDefined();
      expect(screen.getByText("Avg Function Duration")).toBeDefined();
    });
  });

  it("shows error state with retry button when all fetches fail", async () => {
    await mockAllFailure();
    render(<DashboardTab />);

    await vi.waitFor(() => {
      expect(screen.getByText("Failed to load dashboard data")).toBeDefined();
      expect(screen.getByText("Connection refused")).toBeDefined();
      expect(screen.getByText("Retry")).toBeDefined();
    });
  });

  it("retries on retry button click", async () => {
    await mockAllFailure();
    render(<DashboardTab />);

    await vi.waitFor(() => {
      expect(screen.getByText("Retry")).toBeDefined();
    });

    // Switch to success for retry
    await mockAllSuccess();
    fireEvent.click(screen.getByText("Retry"));

    await vi.waitFor(() => {
      expect(screen.getByText("12")).toBeDefined();
    });
  });

  it("displays auto-refresh countdown", async () => {
    await mockAllSuccess();
    render(<DashboardTab />);

    await vi.waitFor(() => {
      expect(screen.getByText(/Refresh in/)).toBeDefined();
    });
  });

  it("displays Refresh button", async () => {
    await mockAllSuccess();
    render(<DashboardTab />);

    await vi.waitFor(() => {
      expect(screen.getByText("Refresh")).toBeDefined();
    });
  });
});
