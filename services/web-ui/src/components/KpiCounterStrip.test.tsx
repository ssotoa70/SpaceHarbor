import { describe, test, expect, vi, afterEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import { KpiCounterStrip } from "./KpiCounterStrip";
import * as api from "../api";
import { __resetAssetStatsCacheForTests } from "../hooks/useAssetStats";

afterEach(() => {
  __resetAssetStatsCacheForTests();
  vi.restoreAllMocks();
});

describe("KpiCounterStrip", () => {
  test("loading: renders 5 skeleton placeholders", () => {
    vi.spyOn(api, "fetchAssetStats").mockReturnValue(new Promise(() => {}));
    const { container } = render(<KpiCounterStrip />);
    expect(container.querySelectorAll('[data-testid="kpi-skeleton"]').length).toBe(5);
  });

  test("success: renders 5 counter values", async () => {
    vi.spyOn(api, "fetchAssetStats").mockResolvedValue({
      total: 123, byStatus: { pending: 2, in_pipeline: 3, processed: 100 },
      byKind: {}, integrity: { hashed: 50, with_keyframes: 40 },
    });
    render(<KpiCounterStrip />);
    await waitFor(() => expect(screen.getByText("123")).toBeInTheDocument());
    expect(screen.getByText("5")).toBeInTheDocument(); // pending + in_pipeline
    expect(screen.getByText("100")).toBeInTheDocument();
    expect(screen.getByText("50")).toBeInTheDocument();
    expect(screen.getByText("40")).toBeInTheDocument();
  });

  test("error: each counter shows —", async () => {
    vi.spyOn(api, "fetchAssetStats").mockRejectedValue(new Error("boom"));
    render(<KpiCounterStrip />);
    await waitFor(() => expect(screen.getAllByText("—").length).toBe(5));
  });

  test("revalidate on window focus fetches again", async () => {
    const fetchMock = vi.spyOn(api, "fetchAssetStats").mockResolvedValue({
      total: 1, byStatus: {}, byKind: {}, integrity: { hashed: 0, with_keyframes: 0 },
    });
    render(<KpiCounterStrip />);
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    window.dispatchEvent(new FocusEvent("focus"));
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));
  });
});
