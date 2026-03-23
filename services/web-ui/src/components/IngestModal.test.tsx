import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

import * as api from "../api";

import { IngestModal } from "./IngestModal";

vi.mock("../api");

describe("IngestModal", () => {
  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  it("renders form fields when open", () => {
    render(<IngestModal open={true} onClose={vi.fn()} onSuccess={vi.fn()} />);

    expect(screen.getByLabelText("Name")).toBeInTheDocument();
    expect(screen.getByLabelText("File URI")).toBeInTheDocument();
    expect(screen.getByLabelText("Project")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Ingest" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Cancel" })).toBeInTheDocument();
  });

  it("does not render when closed", () => {
    render(<IngestModal open={false} onClose={vi.fn()} onSuccess={vi.fn()} />);

    expect(screen.queryByLabelText("Name")).not.toBeInTheDocument();
  });

  it("submits form and calls ingestAsset", async () => {
    vi.mocked(api.ingestAsset).mockResolvedValue(undefined);
    const onSuccess = vi.fn();

    render(<IngestModal open={true} onClose={vi.fn()} onSuccess={onSuccess} />);

    await userEvent.type(screen.getByLabelText("Name"), "Test Asset");
    await userEvent.type(screen.getByLabelText("File URI"), "/vast/test.exr");
    await userEvent.click(screen.getByRole("button", { name: "Ingest" }));

    await waitFor(() => {
      expect(api.ingestAsset).toHaveBeenCalledWith({
        title: "Test Asset",
        sourceUri: "/vast/test.exr",
        projectId: undefined
      });
    });
    expect(onSuccess).toHaveBeenCalled();
  });

  it("shows error on ingest failure", async () => {
    vi.mocked(api.ingestAsset).mockRejectedValue(new Error("Bad request"));

    render(<IngestModal open={true} onClose={vi.fn()} onSuccess={vi.fn()} />);

    await userEvent.type(screen.getByLabelText("Name"), "Test Asset");
    await userEvent.type(screen.getByLabelText("File URI"), "/vast/test.exr");
    await userEvent.click(screen.getByRole("button", { name: "Ingest" }));

    await waitFor(() => {
      expect(screen.getByRole("alert")).toHaveTextContent("Bad request");
    });
  });

  it("calls onClose when Cancel is clicked", async () => {
    const onClose = vi.fn();

    render(<IngestModal open={true} onClose={onClose} onSuccess={vi.fn()} />);

    await userEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(onClose).toHaveBeenCalled();
  });
});
