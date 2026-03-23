import { render, screen } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach } from "vitest";

import { SessionsListPage } from "./SessionsListPage";

vi.mock("../api", () => ({
  fetchReviewSessions: vi.fn().mockResolvedValue([
    {
      id: "s1",
      name: "Dailies 2026-03-15",
      projectId: "p1",
      createdBy: "supervisor",
      status: "active",
      itemCount: 12,
      createdAt: "2026-03-15T09:00:00Z",
      completedAt: null,
    },
    {
      id: "s2",
      name: "Client Review #4",
      projectId: "p1",
      createdBy: "producer",
      status: "completed",
      itemCount: 8,
      createdAt: "2026-03-14T10:00:00Z",
      completedAt: "2026-03-14T12:00:00Z",
    },
  ]),
}));

describe("SessionsListPage", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("renders sessions heading", () => {
    render(<SessionsListPage />);
    expect(screen.getByText("Review Sessions")).toBeInTheDocument();
  });

  it("renders session list after loading", async () => {
    render(<SessionsListPage />);
    expect(await screen.findByText("Dailies 2026-03-15")).toBeInTheDocument();
    expect(screen.getByText("Client Review #4")).toBeInTheDocument();
  });

  it("shows session status badges", async () => {
    render(<SessionsListPage />);
    await screen.findByText("Dailies 2026-03-15");
    expect(screen.getByText("active")).toBeInTheDocument();
    expect(screen.getByText("completed")).toBeInTheDocument();
  });

  it("shows item count", async () => {
    render(<SessionsListPage />);
    await screen.findByText("Dailies 2026-03-15");
    expect(screen.getByText("12")).toBeInTheDocument();
    expect(screen.getByText("8")).toBeInTheDocument();
  });
});
