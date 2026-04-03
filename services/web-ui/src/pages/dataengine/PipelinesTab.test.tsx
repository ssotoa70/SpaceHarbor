import { cleanup, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { VastPipeline } from "../../types/dataengine";

// Mock the API module
vi.mock("../../api/dataengine-proxy");

// Import after mock so we get the mocked versions
import * as api from "../../api/dataengine-proxy";
import { PipelinesTab } from "./PipelinesTab";

const SAMPLE_PIPELINES: VastPipeline[] = [
  {
    id: 1,
    name: "media-ingest-pipeline",
    description: "Ingests media assets and extracts metadata",
    status: "Draft",
    kubernetes_cluster: "prod-cluster",
    namespace: "dataengine",
    environment_variables: {},
    tags: {},
    manifest: {
      triggers: [{ trigger_guid: "trg-001" }],
      functions: [
        {
          function_guid: "fn-001",
          function_vrn: "vrn:vast:function:fn-001",
        },
      ],
    },
    created_at: "2026-03-15T10:00:00Z",
    updated_at: "2026-03-16T12:00:00Z",
  },
  {
    id: 2,
    name: "transcoding-pipeline",
    description: "Transcodes video to multiple formats",
    status: "Running",
    kubernetes_cluster: "prod-cluster",
    namespace: "dataengine",
    environment_variables: {},
    tags: {},
    manifest: null,
    created_at: "2026-03-20T08:30:00Z",
    updated_at: "2026-03-20T08:30:00Z",
  },
  {
    id: 3,
    name: "failed-pipeline",
    description: "A pipeline that has failed",
    status: "Failure",
    kubernetes_cluster: undefined,
    namespace: undefined,
    environment_variables: {},
    tags: {},
    manifest: null,
    created_at: "2026-03-22T14:00:00Z",
    updated_at: "2026-03-22T15:00:00Z",
  },
];

describe("PipelinesTab", () => {
  beforeEach(() => {
    vi.mocked(api.fetchVastPipelines).mockResolvedValue(SAMPLE_PIPELINES);
    vi.mocked(api.deleteVastPipeline).mockResolvedValue(undefined);
    vi.mocked(api.deployVastPipeline).mockResolvedValue(undefined);
    vi.mocked(api.createVastPipeline).mockResolvedValue(SAMPLE_PIPELINES[0]);
    vi.mocked(api.updateVastPipeline).mockResolvedValue(SAMPLE_PIPELINES[0]);
  });

  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  it("renders loading skeleton initially", () => {
    // Never resolve the fetch so we stay in loading state
    vi.mocked(api.fetchVastPipelines).mockReturnValue(new Promise(() => {}));

    render(<PipelinesTab />);

    expect(screen.getByTestId("pipelines-loading")).toBeInTheDocument();
  });

  it("shows pipelines table after data loads", async () => {
    render(<PipelinesTab />);

    await waitFor(() => {
      expect(screen.getByTestId("pipelines-table")).toBeInTheDocument();
    });

    expect(screen.getByText("media-ingest-pipeline")).toBeInTheDocument();
    expect(screen.getByText("transcoding-pipeline")).toBeInTheDocument();
    expect(screen.getByText("failed-pipeline")).toBeInTheDocument();
  });

  it("shows correct status badges", async () => {
    render(<PipelinesTab />);

    await waitFor(() => {
      expect(screen.getByTestId("pipelines-table")).toBeInTheDocument();
    });

    // Check badge text content
    expect(screen.getByTestId("pipeline-status-1")).toHaveTextContent("Draft");
    expect(screen.getByTestId("pipeline-status-2")).toHaveTextContent("Running");
    expect(screen.getByTestId("pipeline-status-3")).toHaveTextContent("Failure");
  });

  it("shows Deploy button for Draft pipelines but not Running", async () => {
    render(<PipelinesTab />);

    await waitFor(() => {
      expect(screen.getByTestId("pipelines-table")).toBeInTheDocument();
    });

    // Draft pipeline (id=1) should have Deploy button
    expect(screen.getByTestId("pipeline-deploy-1")).toBeInTheDocument();

    // Running pipeline (id=2) should NOT have Deploy button
    expect(screen.queryByTestId("pipeline-deploy-2")).not.toBeInTheDocument();

    // Failure pipeline (id=3) should have Deploy button
    expect(screen.getByTestId("pipeline-deploy-3")).toBeInTheDocument();
  });

  it("calls deployVastPipeline when Deploy is clicked", async () => {
    render(<PipelinesTab />);

    await waitFor(() => {
      expect(screen.getByTestId("pipelines-table")).toBeInTheDocument();
    });

    await userEvent.click(screen.getByTestId("pipeline-deploy-1"));

    await waitFor(() => {
      expect(api.deployVastPipeline).toHaveBeenCalledWith(1);
    });
  });

  it("opens create modal on button click", async () => {
    render(<PipelinesTab />);

    await waitFor(() => {
      expect(screen.getByTestId("pipelines-table")).toBeInTheDocument();
    });

    await userEvent.click(screen.getByRole("button", { name: "Create Pipeline" }));

    expect(screen.getByTestId("pipeline-create-modal")).toBeInTheDocument();
    expect(screen.getByLabelText("Name")).toBeInTheDocument();
  });

  it("shows delete confirmation before deletion", async () => {
    render(<PipelinesTab />);

    await waitFor(() => {
      expect(screen.getByTestId("pipelines-table")).toBeInTheDocument();
    });

    // Find and click the delete button for the first pipeline
    const firstRow = screen.getByTestId("pipeline-row-1");
    const deleteBtn = within(firstRow).getByRole("button", { name: "Delete" });
    await userEvent.click(deleteBtn);

    // Confirmation modal should appear
    const modal = screen.getByTestId("delete-confirm-modal");
    expect(modal).toBeInTheDocument();
    expect(within(modal).getByText(/media-ingest-pipeline/)).toBeInTheDocument();

    // Confirm deletion
    await userEvent.click(within(modal).getByRole("button", { name: "Delete" }));

    await waitFor(() => {
      expect(api.deleteVastPipeline).toHaveBeenCalledWith(1);
    });
  });

  it("shows empty state when no pipelines exist", async () => {
    vi.mocked(api.fetchVastPipelines).mockResolvedValue([]);

    render(<PipelinesTab />);

    await waitFor(() => {
      expect(screen.getByTestId("pipelines-empty")).toBeInTheDocument();
    });

    expect(screen.getByText("No pipelines yet")).toBeInTheDocument();
  });

  it("shows error state with retry button", async () => {
    vi.mocked(api.fetchVastPipelines).mockRejectedValue(
      new Error("Connection refused"),
    );

    render(<PipelinesTab />);

    await waitFor(() => {
      expect(screen.getByTestId("pipelines-error")).toBeInTheDocument();
    });

    expect(screen.getByText("Connection refused")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Retry" })).toBeInTheDocument();

    // Click retry -- should call fetch again
    vi.mocked(api.fetchVastPipelines).mockResolvedValue(SAMPLE_PIPELINES);
    await userEvent.click(screen.getByRole("button", { name: "Retry" }));

    await waitFor(() => {
      expect(screen.getByTestId("pipelines-table")).toBeInTheDocument();
    });
  });

  it("filters pipelines by search query", async () => {
    render(<PipelinesTab />);

    await waitFor(() => {
      expect(screen.getByTestId("pipelines-table")).toBeInTheDocument();
    });

    const searchInput = screen.getByTestId("pipelines-search");
    await userEvent.type(searchInput, "transcoding");

    // Wait for debounce
    await waitFor(() => {
      expect(screen.getByText("transcoding-pipeline")).toBeInTheDocument();
      expect(screen.queryByText("media-ingest-pipeline")).not.toBeInTheDocument();
    });
  });

  it("opens manifest editor on Manifest button click", async () => {
    render(<PipelinesTab />);

    await waitFor(() => {
      expect(screen.getByTestId("pipelines-table")).toBeInTheDocument();
    });

    await userEvent.click(screen.getByTestId("pipeline-manifest-1"));

    expect(screen.getByTestId("pipeline-manifest-editor")).toBeInTheDocument();
    expect(screen.getByTestId("manifest-readonly")).toBeInTheDocument();
  });
});
