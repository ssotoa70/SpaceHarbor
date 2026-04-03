import { cleanup, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { VastFunction } from "../../types/dataengine";

// Mock the API module
vi.mock("../../api/dataengine-proxy");

// Import after mock so we get the mocked versions
import * as api from "../../api/dataengine-proxy";
import { FunctionsTab } from "./FunctionsTab";

const SAMPLE_FUNCTIONS: VastFunction[] = [
  {
    guid: "fn-001",
    name: "thumbnail-generator",
    description: "Generates thumbnails from video frames",
    owner: "admin",
    created_at: "2026-03-15T10:00:00Z",
    modified_at: "2026-03-16T12:00:00Z",
    current_version: 2,
    revision_count: 3,
    tags: {},
    vrn: "vrn:vast:function:fn-001",
  },
  {
    guid: "fn-002",
    name: "metadata-extractor",
    description: "Extracts EXIF and XMP metadata",
    owner: "ops",
    created_at: "2026-03-20T08:30:00Z",
    modified_at: "2026-03-20T08:30:00Z",
    current_version: 1,
    revision_count: 1,
    tags: {},
    vrn: "vrn:vast:function:fn-002",
  },
];

describe("FunctionsTab", () => {
  beforeEach(() => {
    vi.mocked(api.fetchVastFunctions).mockResolvedValue(SAMPLE_FUNCTIONS);
    vi.mocked(api.deleteVastFunction).mockResolvedValue(undefined);
    vi.mocked(api.createVastFunction).mockResolvedValue(SAMPLE_FUNCTIONS[0]);
    vi.mocked(api.fetchFunctionRevisions).mockResolvedValue([]);
    vi.mocked(api.fetchContainerRegistries).mockResolvedValue([]);
  });

  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  it("renders loading skeleton initially", () => {
    // Never resolve the fetch so we stay in loading state
    vi.mocked(api.fetchVastFunctions).mockReturnValue(new Promise(() => {}));

    render(<FunctionsTab />);

    expect(screen.getByTestId("functions-loading")).toBeInTheDocument();
  });

  it("shows functions table after data loads", async () => {
    render(<FunctionsTab />);

    await waitFor(() => {
      expect(screen.getByTestId("functions-table")).toBeInTheDocument();
    });

    expect(screen.getByText("thumbnail-generator")).toBeInTheDocument();
    expect(screen.getByText("metadata-extractor")).toBeInTheDocument();
  });

  it("shows empty state when no functions exist", async () => {
    vi.mocked(api.fetchVastFunctions).mockResolvedValue([]);

    render(<FunctionsTab />);

    await waitFor(() => {
      expect(screen.getByTestId("functions-empty")).toBeInTheDocument();
    });

    expect(screen.getByText("No functions yet")).toBeInTheDocument();
  });

  it("shows error state with retry button", async () => {
    vi.mocked(api.fetchVastFunctions).mockRejectedValue(
      new Error("Connection refused"),
    );

    render(<FunctionsTab />);

    await waitFor(() => {
      expect(screen.getByTestId("functions-error")).toBeInTheDocument();
    });

    expect(screen.getByText("Connection refused")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Retry" })).toBeInTheDocument();

    // Click retry — should call fetch again
    vi.mocked(api.fetchVastFunctions).mockResolvedValue(SAMPLE_FUNCTIONS);
    await userEvent.click(screen.getByRole("button", { name: "Retry" }));

    await waitFor(() => {
      expect(screen.getByTestId("functions-table")).toBeInTheDocument();
    });
  });

  it("opens create modal on button click", async () => {
    render(<FunctionsTab />);

    await waitFor(() => {
      expect(screen.getByTestId("functions-table")).toBeInTheDocument();
    });

    await userEvent.click(screen.getByRole("button", { name: "Create Function" }));

    expect(screen.getByTestId("function-create-modal")).toBeInTheDocument();
    expect(screen.getByLabelText("Name")).toBeInTheDocument();
  });

  it("shows delete confirmation before deletion", async () => {
    render(<FunctionsTab />);

    await waitFor(() => {
      expect(screen.getByTestId("functions-table")).toBeInTheDocument();
    });

    // Find and click the delete button for the first function
    const firstRow = screen.getByTestId("function-row-fn-001");
    const deleteBtn = within(firstRow).getByRole("button", { name: "Delete" });
    await userEvent.click(deleteBtn);

    // Confirmation modal should appear
    const modal = screen.getByTestId("delete-confirm-modal");
    expect(modal).toBeInTheDocument();
    expect(within(modal).getByText(/thumbnail-generator/)).toBeInTheDocument();

    // Confirm deletion (click Delete button inside the modal)
    await userEvent.click(within(modal).getByRole("button", { name: "Delete" }));

    await waitFor(() => {
      expect(api.deleteVastFunction).toHaveBeenCalledWith("fn-001");
    });
  });

  it("filters functions by search query", async () => {
    render(<FunctionsTab />);

    await waitFor(() => {
      expect(screen.getByTestId("functions-table")).toBeInTheDocument();
    });

    const searchInput = screen.getByTestId("functions-search");
    await userEvent.type(searchInput, "thumbnail");

    // Wait for debounce
    await waitFor(() => {
      expect(screen.getByText("thumbnail-generator")).toBeInTheDocument();
      expect(screen.queryByText("metadata-extractor")).not.toBeInTheDocument();
    });
  });
});
