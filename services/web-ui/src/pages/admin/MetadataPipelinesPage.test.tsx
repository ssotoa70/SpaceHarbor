// services/web-ui/src/pages/admin/MetadataPipelinesPage.test.tsx
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import * as api from "../../api";
import { MetadataPipelinesPage } from "./MetadataPipelinesPage";

describe("MetadataPipelinesPage", () => {
  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  it("renders the title while loading", async () => {
    vi.spyOn(api, "fetchActiveDataEnginePipelines").mockImplementation(
      () => new Promise(() => {}), // never resolves
    );
    render(<MetadataPipelinesPage />);
    expect(screen.getByRole("heading", { name: /metadata pipelines/i })).toBeInTheDocument();
    expect(screen.getByText(/loading/i)).toBeInTheDocument();
  });

  it("renders empty-state seed button when no pipelines are configured", async () => {
    vi.spyOn(api, "fetchActiveDataEnginePipelines").mockResolvedValue({ pipelines: [] });
    render(<MetadataPipelinesPage />);
    await waitFor(() =>
      expect(screen.getByRole("button", { name: /seed defaults/i })).toBeInTheDocument(),
    );
    expect(screen.queryByRole("table")).not.toBeInTheDocument();
  });

  it("surfaces a fetch error as a banner", async () => {
    vi.spyOn(api, "fetchActiveDataEnginePipelines").mockRejectedValue(
      new Error("boom"),
    );
    render(<MetadataPipelinesPage />);
    await waitFor(() => expect(screen.getByText(/boom/)).toBeInTheDocument());
  });
});
