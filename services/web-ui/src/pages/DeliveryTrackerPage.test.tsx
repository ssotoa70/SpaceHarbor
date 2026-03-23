import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { DeliveryTrackerPage } from "./DeliveryTrackerPage";

// Mock API
vi.mock("../api", async () => {
  const actual = await vi.importActual("../api");
  return {
    ...actual,
    fetchDeliveryStatus: vi.fn().mockResolvedValue([
      { id: "d-1", shotCode: "SH010", sequenceName: "SEQ_A", status: "delivered", deliverableType: "Final Comp", targetDate: "2026-03-15", deliveredAt: "2026-03-15T16:00:00Z", assignee: "alice@studio.com", notes: null },
      { id: "d-2", shotCode: "SH020", sequenceName: "SEQ_A", status: "in_progress", deliverableType: "Final Comp", targetDate: "2026-03-22", deliveredAt: null, assignee: "alice@studio.com", notes: null },
      { id: "d-3", shotCode: "SH035", sequenceName: "SEQ_B", status: "rejected", deliverableType: "FX Plate", targetDate: "2026-03-25", deliveredAt: null, assignee: "bob@studio.com", notes: "Color mismatch" },
    ]),
  };
});

// Mock ProjectContext
vi.mock("../contexts/ProjectContext", () => ({
  useProject: () => ({
    project: { id: "proj-1", label: "Project Alpha", type: "project" },
    projects: [],
    loading: false,
    selectProject: vi.fn(),
    refreshProjects: vi.fn(),
  }),
}));

function renderPage() {
  return render(
    <MemoryRouter>
      <DeliveryTrackerPage />
    </MemoryRouter>,
  );
}

describe("DeliveryTrackerPage", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("renders the page title", () => {
    renderPage();
    expect(screen.getByText("Delivery Tracker")).toBeDefined();
  });

  it("renders delivery table", async () => {
    renderPage();
    await vi.waitFor(() => {
      expect(screen.getByTestId("delivery-table")).toBeDefined();
      expect(screen.getByText("SH010")).toBeDefined();
      expect(screen.getByText("SH020")).toBeDefined();
      expect(screen.getByText("SH035")).toBeDefined();
    });
  });

  it("renders status badges", async () => {
    renderPage();
    await vi.waitFor(() => {
      expect(screen.getByText("Delivered")).toBeDefined();
      expect(screen.getByText("In Progress")).toBeDefined();
      expect(screen.getByText("Rejected")).toBeDefined();
    });
  });

  it("renders summary counts", async () => {
    renderPage();
    await vi.waitFor(() => {
      expect(screen.getByTestId("delivery-summary")).toBeDefined();
    });
  });

  it("filters by status", async () => {
    renderPage();
    await vi.waitFor(() => {
      expect(screen.getByText("SH010")).toBeDefined();
    });

    fireEvent.change(screen.getByTestId("status-filter"), { target: { value: "rejected" } });
    await vi.waitFor(() => {
      expect(screen.getByText("SH035")).toBeDefined();
      expect(screen.queryByText("SH010")).toBeNull();
    });
  });

  it("shows project in description", () => {
    renderPage();
    expect(screen.getByText(/Project Alpha/)).toBeDefined();
  });
});
