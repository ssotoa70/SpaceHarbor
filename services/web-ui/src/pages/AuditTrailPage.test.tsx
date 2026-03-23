import { render, screen } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach } from "vitest";

import { AuditTrailPage } from "./AuditTrailPage";

vi.mock("../api", () => ({
  fetchAuditDecisions: vi.fn().mockResolvedValue([
    { id: "d1", userId: "u1", userEmail: "admin@studio.com", action: "browse:assets", resource: "/api/v1/assets", decision: "allow", reason: null, timestamp: "2026-03-15T10:00:00Z" },
    { id: "d2", userId: "u2", userEmail: "viewer@studio.com", action: "admin:system_config", resource: "/api/v1/platform/settings", decision: "deny", reason: "Insufficient role", timestamp: "2026-03-15T10:05:00Z" },
  ]),
}));

vi.mock("../components/PermissionGate", () => ({
  PermissionGate: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  useHasPermission: () => true,
}));

describe("AuditTrailPage", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("renders audit trail heading", () => {
    render(<AuditTrailPage />);
    expect(screen.getByText("Audit Trail")).toBeInTheDocument();
  });

  it("renders audit decisions after loading", async () => {
    render(<AuditTrailPage />);
    expect(await screen.findByText("admin@studio.com")).toBeInTheDocument();
    expect(screen.getByText("viewer@studio.com")).toBeInTheDocument();
  });

  it("shows decision badges", async () => {
    render(<AuditTrailPage />);
    await screen.findByText("admin@studio.com");
    expect(screen.getByText("allow")).toBeInTheDocument();
    expect(screen.getByText("deny")).toBeInTheDocument();
  });

  it("shows action column", async () => {
    render(<AuditTrailPage />);
    await screen.findByText("admin@studio.com");
    expect(screen.getByText("browse:assets")).toBeInTheDocument();
    expect(screen.getByText("admin:system_config")).toBeInTheDocument();
  });

  it("renders filter controls", () => {
    render(<AuditTrailPage />);
    expect(screen.getByPlaceholderText("Filter by user ID...")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Apply Filters" })).toBeInTheDocument();
  });
});
