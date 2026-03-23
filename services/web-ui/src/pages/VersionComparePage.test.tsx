import { render, screen } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach } from "vitest";

import { VersionComparePage } from "./VersionComparePage";

vi.mock("../api", () => ({
  fetchApprovalQueue: vi.fn().mockResolvedValue({
    assets: [
      { id: "a1", title: "shot_010_v002.exr", status: "qc_pending", sourceUri: "/proxy/shot010_v2.mp4", jobId: "j1", proxy: { uri: "/proxy/shot010_v2.mp4", durationSeconds: 10, codec: "h264", generatedAt: "2026-03-15T10:00:00Z" }, version: { version_label: "v2" } },
      { id: "a2", title: "shot_010_v003.exr", status: "qc_pending", sourceUri: "/proxy/shot010_v3.mp4", jobId: "j2", proxy: { uri: "/proxy/shot010_v3.mp4", durationSeconds: 10, codec: "h264", generatedAt: "2026-03-15T10:00:00Z" }, version: { version_label: "v3" } },
    ],
    total: 2,
  }),
}));

vi.mock("../components/PermissionGate", () => ({
  PermissionGate: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  useHasPermission: () => true,
}));

vi.mock("../components/VersionCompareViewer", () => ({
  VersionCompareViewer: () => <div data-testid="version-compare-viewer">Compare Viewer</div>,
}));

describe("VersionComparePage", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("renders version compare heading", () => {
    render(<VersionComparePage />);
    expect(screen.getByText("Version Compare")).toBeInTheDocument();
  });

  it("renders VersionCompareViewer after loading", async () => {
    render(<VersionComparePage />);
    expect(await screen.findByTestId("version-compare-viewer")).toBeInTheDocument();
  });

  it("renders description text", () => {
    render(<VersionComparePage />);
    expect(screen.getByText(/Compare versions side-by-side/)).toBeInTheDocument();
  });
});
