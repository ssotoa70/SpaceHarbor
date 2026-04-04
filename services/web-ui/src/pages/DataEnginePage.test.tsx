import { render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { describe, it, expect, vi, beforeEach } from "vitest";

import { DataEnginePage } from "./DataEnginePage";

function renderWithRouter(ui: React.ReactElement) {
  return render(<MemoryRouter>{ui}</MemoryRouter>);
}

// Mock PermissionGate to always render children
vi.mock("../components/PermissionGate", () => ({
  PermissionGate: ({
    children,
    permission,
  }: {
    children: React.ReactNode;
    fallback?: React.ReactNode;
    permission: string;
  }) => (
    <div data-testid="permission-gate" data-permission={permission}>
      {children}
    </div>
  ),
  useHasPermission: () => true,
}));

// Mock fetchPlatformSettings to simulate connection states
const mockFetchSettings = vi.fn();
vi.mock("../api", () => ({
  fetchPlatformSettings: (...args: unknown[]) => mockFetchSettings(...args),
}));

// Mock lazy-loaded tab components
vi.mock("./dataengine/DashboardTab", () => ({
  DashboardTab: () => <div data-testid="dashboard-tab">Dashboard Content</div>,
}));
vi.mock("./dataengine/FunctionsTab", () => ({
  FunctionsTab: () => <div data-testid="functions-tab">Functions Content</div>,
}));
vi.mock("./dataengine/TriggersTab", () => ({
  TriggersTab: () => <div data-testid="triggers-tab">Triggers Content</div>,
}));
vi.mock("./dataengine/PipelinesTab", () => ({
  PipelinesTab: () => <div data-testid="pipelines-tab">Pipelines Content</div>,
}));
vi.mock("./dataengine/TelemetryTab", () => ({
  TelemetryTab: () => <div data-testid="telemetry-tab">Telemetry Content</div>,
}));

describe("DataEnginePage", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("wraps content with PermissionGate using admin:system_config", async () => {
    mockFetchSettings.mockResolvedValue({
      vastDataEngine: { configured: true, hasPassword: true },
    });
    renderWithRouter(<DataEnginePage />);
    const gate = screen.getByTestId("permission-gate");
    expect(gate).toHaveAttribute("data-permission", "admin:system_config");
  });

  it("shows ConnectionBanner when VAST DataEngine is not configured", async () => {
    mockFetchSettings.mockResolvedValue({
      vastDataEngine: { configured: false, hasPassword: false },
    });
    renderWithRouter(<DataEnginePage />);
    await waitFor(() => {
      expect(screen.getByText("VAST DataEngine Not Configured")).toBeInTheDocument();
    });
  });

  it("shows ConnectionBanner when credentials are missing", async () => {
    mockFetchSettings.mockResolvedValue({
      vastDataEngine: { configured: true, hasPassword: false },
    });
    renderWithRouter(<DataEnginePage />);
    await waitFor(() => {
      expect(screen.getByText("VAST DataEngine Not Configured")).toBeInTheDocument();
    });
  });

  it("shows tab bar when connected", async () => {
    mockFetchSettings.mockResolvedValue({
      vastDataEngine: { configured: true, hasPassword: true },
    });
    renderWithRouter(<DataEnginePage />);
    await waitFor(() => {
      expect(screen.getByRole("tab", { name: "Dashboard" })).toBeInTheDocument();
      expect(screen.getByRole("tab", { name: "Functions" })).toBeInTheDocument();
      expect(screen.getByRole("tab", { name: "Triggers" })).toBeInTheDocument();
      expect(screen.getByRole("tab", { name: "Pipelines" })).toBeInTheDocument();
      expect(screen.getByRole("tab", { name: "Telemetry" })).toBeInTheDocument();
    });
  });

  it("shows Dashboard tab by default", async () => {
    mockFetchSettings.mockResolvedValue({
      vastDataEngine: { configured: true, hasPassword: true },
    });
    renderWithRouter(<DataEnginePage />);
    await waitFor(() => {
      expect(screen.getByTestId("dashboard-tab")).toBeInTheDocument();
    });
    expect(screen.getByRole("tab", { name: "Dashboard" })).toHaveAttribute(
      "aria-selected",
      "true",
    );
  });

  it("switches to Functions tab on click", async () => {
    mockFetchSettings.mockResolvedValue({
      vastDataEngine: { configured: true, hasPassword: true },
    });
    renderWithRouter(<DataEnginePage />);
    await waitFor(() => {
      expect(screen.getByRole("tab", { name: "Functions" })).toBeInTheDocument();
    });
    screen.getByRole("tab", { name: "Functions" }).click();
    await waitFor(() => {
      expect(screen.getByTestId("functions-tab")).toBeInTheDocument();
    });
  });

  it("switches to Triggers tab on click", async () => {
    mockFetchSettings.mockResolvedValue({
      vastDataEngine: { configured: true, hasPassword: true },
    });
    renderWithRouter(<DataEnginePage />);
    await waitFor(() => {
      expect(screen.getByRole("tab", { name: "Triggers" })).toBeInTheDocument();
    });
    screen.getByRole("tab", { name: "Triggers" }).click();
    await waitFor(() => {
      expect(screen.getByTestId("triggers-tab")).toBeInTheDocument();
    });
  });

  it("switches to Pipelines tab on click", async () => {
    mockFetchSettings.mockResolvedValue({
      vastDataEngine: { configured: true, hasPassword: true },
    });
    renderWithRouter(<DataEnginePage />);
    await waitFor(() => {
      expect(screen.getByRole("tab", { name: "Pipelines" })).toBeInTheDocument();
    });
    screen.getByRole("tab", { name: "Pipelines" }).click();
    await waitFor(() => {
      expect(screen.getByTestId("pipelines-tab")).toBeInTheDocument();
    });
  });

  it("switches to Telemetry tab on click", async () => {
    mockFetchSettings.mockResolvedValue({
      vastDataEngine: { configured: true, hasPassword: true },
    });
    renderWithRouter(<DataEnginePage />);
    await waitFor(() => {
      expect(screen.getByRole("tab", { name: "Telemetry" })).toBeInTheDocument();
    });
    screen.getByRole("tab", { name: "Telemetry" }).click();
    await waitFor(() => {
      expect(screen.getByTestId("telemetry-tab")).toBeInTheDocument();
    });
  });
});
