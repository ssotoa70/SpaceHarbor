import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { QueryConsolePage } from "./QueryConsolePage";

// Mock API
vi.mock("../api", async () => {
  const actual = await vi.importActual("../api");
  return {
    ...actual,
    executeQuery: vi.fn().mockResolvedValue({
      columns: ["id", "name", "status"],
      rows: [
        ["ast-001", "hero.exr", "approved"],
        ["ast-002", "env.usd", "pending"],
      ],
      rowCount: 2,
      truncated: false,
      durationMs: 42,
      queryId: "q-123",
    }),
    fetchQueryHistory: vi.fn().mockResolvedValue([
      { id: "h1", userId: "u1", sqlText: "SELECT 1", sqlHash: "abc", rowCount: 1, durationMs: 5, status: "success", errorMessage: null, createdAt: "2026-03-16T00:00:00Z" },
    ]),
    cancelQuery: vi.fn().mockResolvedValue(undefined),
  };
});

function renderPage() {
  return render(
    <MemoryRouter>
      <QueryConsolePage />
    </MemoryRouter>,
  );
}

describe("QueryConsolePage", () => {
  beforeEach(async () => {
    vi.restoreAllMocks();
    const api = await import("../api");
    (api.executeQuery as ReturnType<typeof vi.fn>).mockResolvedValue({
      columns: ["id", "name", "status"],
      rows: [
        ["ast-001", "hero.exr", "approved"],
        ["ast-002", "env.usd", "pending"],
      ],
      rowCount: 2,
      truncated: false,
      durationMs: 42,
      queryId: "q-123",
    });
    (api.fetchQueryHistory as ReturnType<typeof vi.fn>).mockResolvedValue([
      { id: "h1", userId: "u1", sqlText: "SELECT 1", sqlHash: "abc", rowCount: 1, durationMs: 5, status: "success", errorMessage: null, createdAt: "2026-03-16T00:00:00Z" },
    ]);
    (api.cancelQuery as ReturnType<typeof vi.fn>).mockResolvedValue(undefined);
  });

  it("renders editor and results area", () => {
    renderPage();
    expect(screen.getByLabelText("SQL editor")).toBeDefined();
    expect(screen.getByText("Run a query to see results")).toBeDefined();
  });

  it("typing updates the editor", () => {
    renderPage();
    const editor = screen.getByLabelText("SQL editor") as HTMLTextAreaElement;
    fireEvent.change(editor, { target: { value: "SELECT COUNT(*) FROM assets" } });
    expect(editor.value).toBe("SELECT COUNT(*) FROM assets");
  });

  it("Run triggers API call", async () => {
    renderPage();
    const runBtn = screen.getByText("Run");
    fireEvent.click(runBtn);
    const api = await import("../api");
    await vi.waitFor(() => {
      expect(api.executeQuery).toHaveBeenCalled();
    });
  });

  it("results table renders after query", async () => {
    renderPage();
    fireEvent.click(screen.getByText("Run"));
    await vi.waitFor(() => {
      expect(screen.getByText("hero.exr")).toBeDefined();
      expect(screen.getByText("env.usd")).toBeDefined();
    });
  });

  it("shows error state", async () => {
    const api = await import("../api");
    (api.executeQuery as ReturnType<typeof vi.fn>).mockRejectedValue(new Error("Syntax error at line 1"));
    renderPage();
    fireEvent.click(screen.getByText("Run"));
    await vi.waitFor(() => {
      expect(screen.getByText("Query Error")).toBeDefined();
      expect(screen.getByText(/Syntax error/)).toBeDefined();
    });
  });

  it("shows Cancel button while running", async () => {
    const api = await import("../api");
    (api.executeQuery as ReturnType<typeof vi.fn>).mockImplementation(() => new Promise(() => {})); // never resolves
    renderPage();
    fireEvent.click(screen.getByText("Run"));
    await vi.waitFor(() => {
      expect(screen.getByText("Cancel")).toBeDefined();
    });
  });

  it("history dropdown opens", async () => {
    renderPage();
    fireEvent.click(screen.getByText("History"));
    await vi.waitFor(() => {
      expect(screen.getByText("Query History")).toBeDefined();
      expect(screen.getByText("SELECT 1")).toBeDefined();
    });
  });

  it("CSV export button appears with results", async () => {
    renderPage();
    fireEvent.click(screen.getByText("Run"));
    await vi.waitFor(() => {
      expect(screen.getByText("CSV")).toBeDefined();
      expect(screen.getByText("JSON")).toBeDefined();
    });
  });

  it("shows Cmd+Enter hint", () => {
    renderPage();
    expect(screen.getByText("Cmd+Enter to run")).toBeDefined();
  });

  it("shows row count and duration after query", async () => {
    renderPage();
    fireEvent.click(screen.getByText("Run"));
    await vi.waitFor(() => {
      expect(screen.getByText("2 rows in 42ms")).toBeDefined();
    });
  });
});
