import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { ReviewButton } from "./ReviewButton";

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe("ReviewButton", () => {
  beforeEach(() => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        asset_id: "abc123",
        uri: "rvlink:///vast/ingest/abc123/hero_plate_v001.exr",
        format: "exr_sequence",
      }),
    });
    vi.spyOn(window, "open").mockImplementation(() => null);
  });

  it("renders Open in RV button", () => {
    render(<ReviewButton assetId="abc123" />);
    expect(screen.getByRole("button", { name: /open in rv/i })).toBeDefined();
  });

  it("fetches review URI and opens rvlink on click", async () => {
    render(<ReviewButton assetId="abc123" />);
    fireEvent.click(screen.getByRole("button", { name: /open in rv/i }));
    await waitFor(() => {
      expect(window.open).toHaveBeenCalledWith(
        "rvlink:///vast/ingest/abc123/hero_plate_v001.exr",
        "_blank",
      );
    });
  });

  it("shows error state when fetch fails", async () => {
    global.fetch = vi.fn().mockResolvedValue({ ok: false, status: 404 });
    render(<ReviewButton assetId="abc123" />);
    fireEvent.click(screen.getByRole("button", { name: /open in rv/i }));
    await waitFor(() => {
      expect(screen.getByText(/failed to open/i)).toBeDefined();
    });
  });

  it("does not render when assetId is undefined", () => {
    const { container } = render(<ReviewButton assetId={undefined} />);
    expect(container.firstChild).toBeNull();
  });
});
