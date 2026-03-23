import { render, screen } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach } from "vitest";

import { UsersRolesPage } from "./UsersRolesPage";

vi.mock("../api", () => ({
  fetchIamUsers: vi.fn().mockResolvedValue([
    { id: "u1", email: "admin@studio.com", displayName: "Admin User", roles: ["admin"], enabled: true, createdAt: "2026-01-01T00:00:00Z", lastLoginAt: "2026-03-15T10:00:00Z" },
    { id: "u2", email: "artist@studio.com", displayName: "Artist User", roles: ["artist"], enabled: true, createdAt: "2026-02-01T00:00:00Z", lastLoginAt: null },
  ]),
  updateUserRole: vi.fn().mockResolvedValue(undefined),
  createIamUser: vi.fn().mockResolvedValue({ id: "u3", email: "new@studio.com", displayName: "New User", roles: ["viewer"], enabled: true, createdAt: "2026-03-16T00:00:00Z", lastLoginAt: null }),
}));

vi.mock("../components/PermissionGate", () => ({
  PermissionGate: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  useHasPermission: () => true,
}));

describe("UsersRolesPage", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("renders users and roles heading", () => {
    render(<UsersRolesPage />);
    expect(screen.getByText("Users & Roles")).toBeInTheDocument();
  });

  it("renders user list after loading", async () => {
    render(<UsersRolesPage />);
    expect(await screen.findByText("Admin User")).toBeInTheDocument();
    expect(screen.getByText("Artist User")).toBeInTheDocument();
  });

  it("shows user emails", async () => {
    render(<UsersRolesPage />);
    await screen.findByText("Admin User");
    expect(screen.getByText("admin@studio.com")).toBeInTheDocument();
    expect(screen.getByText("artist@studio.com")).toBeInTheDocument();
  });

  it("renders create user button", () => {
    render(<UsersRolesPage />);
    expect(screen.getByRole("button", { name: "Create User" })).toBeInTheDocument();
  });

  it("renders role dropdowns for each user", async () => {
    render(<UsersRolesPage />);
    await screen.findByText("Admin User");
    const roleSelects = screen.getAllByRole("combobox");
    expect(roleSelects.length).toBeGreaterThanOrEqual(2);
  });
});
