import { render, screen, fireEvent } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach } from "vitest";

import { DataEnginePage } from "./DataEnginePage";

vi.mock("../components/PermissionGate", () => ({
  PermissionGate: ({
    children,
    fallback,
    permission,
  }: {
    children: React.ReactNode;
    fallback?: React.ReactNode;
    permission: string;
  }) => {
    // Expose permission prop for testing; render children by default
    return (
      <div data-testid="permission-gate" data-permission={permission}>
        {children}
      </div>
    );
  },
  useHasPermission: () => true,
}));

describe("DataEnginePage", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("renders Function Library heading", () => {
    render(<DataEnginePage />);
    expect(screen.getByText("Function Library")).toBeInTheDocument();
  });

  it("renders function library with function cards", () => {
    render(<DataEnginePage />);
    expect(screen.getByText("exr-to-proxy")).toBeInTheDocument();
    expect(screen.getByText("exr-thumbnail")).toBeInTheDocument();
    expect(screen.getByText("ffmpeg-transcode")).toBeInTheDocument();
    expect(screen.getByText("mtlx-parse")).toBeInTheDocument();
    expect(screen.getByText("otio-conform")).toBeInTheDocument();
  });

  it("renders Pipeline View with pipeline name", () => {
    render(<DataEnginePage />);
    expect(screen.getByText("EXR Ingest Pipeline")).toBeInTheDocument();
  });

  it("renders category sections", () => {
    render(<DataEnginePage />);
    expect(screen.getByText("VFX PROCESSING")).toBeInTheDocument();
    expect(screen.getByText("COLOR & GRADE")).toBeInTheDocument();
    expect(screen.getByText("EDITORIAL")).toBeInTheDocument();
    expect(screen.getByText("METADATA & PROVENANCE")).toBeInTheDocument();
    expect(screen.getByText("DELIVERY & NOTIFICATION")).toBeInTheDocument();
  });

  it("renders pipeline steps with status badges", () => {
    render(<DataEnginePage />);
    expect(screen.getByText("Frame Sequence Validator")).toBeInTheDocument();
    expect(screen.getByText("EXR Metadata Extract")).toBeInTheDocument();
    expect(screen.getByText("Generate EXR Proxy")).toBeInTheDocument();
    expect(screen.getByText("AOV Splitter")).toBeInTheDocument();
    // Status badges
    expect(screen.getAllByText("done").length).toBeGreaterThanOrEqual(2);
    expect(screen.getByText("running")).toBeInTheDocument();
    expect(screen.getAllByText("queued").length).toBeGreaterThanOrEqual(3);
  });

  it("wraps content with PermissionGate using admin:system_config", () => {
    render(<DataEnginePage />);
    const gate = screen.getByTestId("permission-gate");
    expect(gate).toHaveAttribute("data-permission", "admin:system_config");
  });

  it("highlights selected function card", () => {
    render(<DataEnginePage />);
    const card = screen.getByText("exr-to-proxy").closest("[role='listitem']")!;
    fireEvent.click(card);
    expect(card.className).toContain("ring-1");
  });

  it("adds function to pipeline via + button", () => {
    render(<DataEnginePage />);
    // Before adding, pipeline has 6 steps
    const addButtons = screen.getAllByLabelText(/Add .+ to pipeline/);
    fireEvent.click(addButtons[0]); // add exr-to-proxy
    // Now the pipeline step list should contain a 7th step with the function name
    const pipelineSteps = screen.getByRole("list", { name: "Pipeline steps" });
    expect(pipelineSteps).toBeInTheDocument();
    // The function name should appear in the pipeline
    const stepsWithName = screen.getAllByText("exr-to-proxy");
    // At least 2: one in library, one in pipeline
    expect(stepsWithName.length).toBeGreaterThanOrEqual(2);
  });
});
