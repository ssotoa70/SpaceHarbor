import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { AnalyticsDashboard } from "./AnalyticsDashboard";

// Mock API
vi.mock("../api", async () => {
  const actual = await vi.importActual("../api");
  return {
    ...actual,
    fetchAnalyticsAssets: vi.fn().mockResolvedValue({
      totalAssets: 1247,
      byStatus: [
        { status: "approved", count: 842 },
        { status: "pending_review", count: 215 },
      ],
      byMediaType: [
        { mediaType: "exr", count: 423 },
        { mediaType: "mov", count: 312 },
      ],
      topAccessed: [
        { assetId: "ast-001", name: "hero.exr", accessCount: 89 },
      ],
      range: "7d",
      cachedAt: new Date().toISOString(),
    }),
    fetchAnalyticsPipeline: vi.fn().mockResolvedValue({
      completionRate: 94.2,
      throughputPerHour: 12.7,
      dlqSize: 3,
      retrySuccessRate: 78.5,
      jobsByStatus: [{ status: "completed", count: 100 }],
      range: "7d",
      cachedAt: new Date().toISOString(),
    }),
    fetchAnalyticsStorage: vi.fn().mockResolvedValue({
      totalBytes: 8.81e12,
      byMediaType: [{ mediaType: "exr", bytes: 3.2e12 }],
      proxyCoverage: 87.3,
      thumbnailCoverage: 95.1,
      growthTrend: [7e12, 8e12, 8.8e12],
      range: "7d",
      cachedAt: new Date().toISOString(),
    }),
    fetchAnalyticsRender: vi.fn().mockResolvedValue({
      totalCoreHours: 12480,
      avgRenderTimeSeconds: 930,
      peakMemoryTrend: [28, 31, 33],
      jobsByEngine: [{ engine: "Arnold", count: 142 }],
      range: "7d",
      cachedAt: new Date().toISOString(),
    }),
  };
});

function renderWithRouter() {
  return render(
    <MemoryRouter>
      <AnalyticsDashboard />
    </MemoryRouter>,
  );
}

describe("AnalyticsDashboard", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("renders loading state initially", () => {
    renderWithRouter();
    expect(screen.getByText("Analytics")).toBeDefined();
  });

  it("renders all 4 tabs", async () => {
    renderWithRouter();
    await vi.waitFor(() => {
      expect(screen.getByText("Assets")).toBeDefined();
      expect(screen.getByText("Pipeline")).toBeDefined();
      expect(screen.getByText("Storage")).toBeDefined();
      expect(screen.getByText("Render Farm")).toBeDefined();
    });
  });

  it("switches tabs on click", async () => {
    renderWithRouter();
    await vi.waitFor(() => expect(screen.getByText("Total Assets")).toBeDefined());

    fireEvent.click(screen.getByText("Pipeline"));
    await vi.waitFor(() => expect(screen.getByText("Completion Rate")).toBeDefined());

    fireEvent.click(screen.getByText("Storage"));
    await vi.waitFor(() => expect(screen.getByText("Total Storage")).toBeDefined());

    fireEvent.click(screen.getByText("Render Farm"));
    await vi.waitFor(() => expect(screen.getByText("Core Hours")).toBeDefined());
  });

  it("renders time range buttons", async () => {
    renderWithRouter();
    await vi.waitFor(() => {
      expect(screen.getByText("24h")).toBeDefined();
      expect(screen.getByText("7d")).toBeDefined();
      expect(screen.getByText("30d")).toBeDefined();
      expect(screen.getByText("90d")).toBeDefined();
    });
  });

  it("renders auto-refresh countdown", async () => {
    renderWithRouter();
    await vi.waitFor(() => {
      expect(screen.getByText(/Refresh in/)).toBeDefined();
    });
  });

  it("renders asset stat cards", async () => {
    renderWithRouter();
    await vi.waitFor(() => {
      expect(screen.getByText("1,247")).toBeDefined();
    });
  });

  it("renders empty state when data is null", async () => {
    const api = await import("../api");
    (api.fetchAnalyticsAssets as ReturnType<typeof vi.fn>).mockResolvedValue(null);
    (api.fetchAnalyticsPipeline as ReturnType<typeof vi.fn>).mockResolvedValue(null);
    (api.fetchAnalyticsStorage as ReturnType<typeof vi.fn>).mockResolvedValue(null);
    (api.fetchAnalyticsRender as ReturnType<typeof vi.fn>).mockResolvedValue(null);

    renderWithRouter();
    await vi.waitFor(() => {
      expect(screen.getByText("No data available")).toBeDefined();
    });
  });
});
