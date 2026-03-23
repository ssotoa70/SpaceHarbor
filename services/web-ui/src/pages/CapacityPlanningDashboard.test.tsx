import { render, screen } from "@testing-library/react";
import { describe, it, expect, vi } from "vitest";

import { CapacityPlanningDashboard } from "./CapacityPlanningDashboard";

vi.mock("../api", async (importOriginal) => {
  const orig = await importOriginal<typeof import("../api")>();
  return {
    ...orig,
    fetchRenderCostReport: vi.fn().mockResolvedValue(null),
    fetchCapacityForecast: vi.fn().mockResolvedValue(null),
    fetchStorageSummary: vi.fn().mockResolvedValue([]),
    fetchCatalogStorageSummary: vi.fn().mockResolvedValue(null),
    fetchCatalogOrphans: vi.fn().mockResolvedValue([]),
  };
});

describe("CapacityPlanningDashboard", () => {
  it("renders page heading", async () => {
    render(<CapacityPlanningDashboard />);
    expect(screen.getByText("Capacity Planning")).toBeInTheDocument();
  });

  it("renders four dashboard card panels", async () => {
    render(<CapacityPlanningDashboard />);
    const heading = await screen.findByText("Render Queue Load by Department");
    expect(heading).toBeInTheDocument();
    expect(screen.getByText("Storage by Department")).toBeInTheDocument();
    expect(screen.getByText("Active Jobs")).toBeInTheDocument();
    expect(screen.getByText("Bottleneck Indicators (7-day rolling)")).toBeInTheDocument();
  });

  it("renders summary stat card labels", async () => {
    render(<CapacityPlanningDashboard />);
    await screen.findByText("Total Storage");
    expect(screen.getByText("Total Files")).toBeInTheDocument();
    expect(screen.getByText("Core Hours")).toBeInTheDocument();
    expect(screen.getByText("Avg Render Time")).toBeInTheDocument();
  });

  it("shows empty state for render chart when no data", async () => {
    render(<CapacityPlanningDashboard />);
    await screen.findByText("Render Queue Load by Department");
    expect(screen.getByText("No render data available")).toBeInTheDocument();
  });

  it("shows empty state for storage when no data", async () => {
    render(<CapacityPlanningDashboard />);
    await screen.findByText("Storage by Department");
    expect(screen.getByText("No storage data available")).toBeInTheDocument();
  });

  it("shows empty state for active jobs when no forecast data", async () => {
    render(<CapacityPlanningDashboard />);
    await screen.findByText("Active Jobs");
    expect(screen.getByText("No capacity data available")).toBeInTheDocument();
  });

  it("shows empty state for bottleneck indicators when no data", async () => {
    render(<CapacityPlanningDashboard />);
    await screen.findByText("Bottleneck Indicators (7-day rolling)");
    expect(screen.getByText("No bottleneck data available")).toBeInTheDocument();
  });

  it("shows VAST Catalog Storage panel", async () => {
    render(<CapacityPlanningDashboard />);
    await screen.findByText("VAST Catalog Storage (Actual Disk)");
    expect(screen.getByText("VAST Catalog not configured")).toBeInTheDocument();
  });

  it("shows Storage Health panel", async () => {
    render(<CapacityPlanningDashboard />);
    await screen.findByText("Storage Health");
    expect(screen.getByText("Orphan Files")).toBeInTheDocument();
  });
});
