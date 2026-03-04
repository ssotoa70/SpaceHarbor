import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { AssetRow } from "../api";
import { OperatorBoard } from "./OperatorBoard";

function buildAsset(overrides: Partial<AssetRow>): AssetRow {
  return {
    id: "asset-1",
    jobId: null,
    title: "Daily News",
    sourceUri: "s3://bucket/news.mov",
    status: "pending",
    productionMetadata: {
      show: null,
      episode: null,
      sequence: null,
      shot: null,
      version: null,
      vendor: null,
      priority: null,
      dueDate: null,
      owner: null
    },
    ...overrides
  };
}

describe("OperatorBoard", () => {
  afterEach(() => {
    cleanup();
  });

  it("renders queue table and empty state", () => {
    render(
      <OperatorBoard
        title=""
        sourceUri=""
        assets={[]}
        onTitleChange={vi.fn()}
        onSourceUriChange={vi.fn()}
        onSubmit={vi.fn()}
        onReplay={vi.fn()}
      />
    );

    expect(screen.getByRole("heading", { name: "Assets Queue" })).toBeInTheDocument();
    expect(screen.getByRole("columnheader", { name: "Title" })).toBeInTheDocument();
    expect(screen.getByRole("columnheader", { name: "Source" })).toBeInTheDocument();
    expect(screen.getByRole("columnheader", { name: "Status" })).toBeInTheDocument();
    expect(screen.getByText("No assets yet.")).toBeInTheDocument();
  });

  it("shows replay action for failed rows and calls replay handler", () => {
    const onReplay = vi.fn();
    const failedAsset = buildAsset({
      id: "asset-failed",
      status: "failed",
      jobId: "job-123"
    });
    const completedAsset = buildAsset({
      id: "asset-completed",
      status: "completed",
      jobId: "job-456"
    });

    render(
      <OperatorBoard
        title=""
        sourceUri=""
        assets={[failedAsset, completedAsset]}
        onTitleChange={vi.fn()}
        onSourceUriChange={vi.fn()}
        onSubmit={vi.fn()}
        onReplay={onReplay}
      />
    );

    const replayButtons = screen.getAllByRole("button", { name: "Replay" });
    expect(replayButtons).toHaveLength(1);

    fireEvent.click(replayButtons[0]);
    expect(onReplay).toHaveBeenCalledWith("job-123");
  });

  it("renders ingest labels and controls", () => {
    const onTitleChange = vi.fn();
    const onSourceUriChange = vi.fn();
    const onSubmit = vi.fn();

    render(
      <OperatorBoard
        title="Current title"
        sourceUri="s3://source.mov"
        assets={[]}
        onTitleChange={onTitleChange}
        onSourceUriChange={onSourceUriChange}
        onSubmit={onSubmit}
        onReplay={vi.fn()}
      />
    );

    expect(screen.getByRole("heading", { name: "Ingest" })).toBeInTheDocument();

    const titleInput = screen.getByRole("textbox", { name: "Title" });
    const sourceUriInput = screen.getByRole("textbox", { name: "Source URI" });
    const registerButton = screen.getByRole("button", { name: "Register Asset" });

    expect(titleInput).toHaveValue("Current title");
    expect(sourceUriInput).toHaveValue("s3://source.mov");

    fireEvent.change(titleInput, { target: { value: "Updated title" } });
    fireEvent.change(sourceUriInput, { target: { value: "s3://updated.mov" } });
    const ingestForm = registerButton.closest("form");
    expect(ingestForm).not.toBeNull();
    fireEvent.submit(ingestForm as HTMLFormElement);

    expect(onTitleChange).toHaveBeenCalledWith("Updated title");
    expect(onSourceUriChange).toHaveBeenCalledWith("s3://updated.mov");
    expect(onSubmit).toHaveBeenCalled();
  });
});
