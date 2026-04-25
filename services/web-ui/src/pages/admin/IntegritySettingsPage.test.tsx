import { describe, test, expect, vi, afterEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { IntegritySettingsPage } from "./IntegritySettingsPage";
import * as api from "../../api";

const ROWS = [
  {
    scope: "asset-integrity",
    key: "hash_timeout_seconds",
    valueType: "duration_seconds" as const,
    value: 120,
    default: 120,
    min: 10,
    max: 600,
    description: "x",
    label: "Hash timeout",
    category: "Hashing",
    lastEditedBy: null,
    lastEditedAt: null,
  },
  {
    scope: "asset-integrity",
    key: "keyframe_count",
    valueType: "int" as const,
    value: 10,
    default: 10,
    min: 1,
    max: 30,
    description: "y",
    label: "Keyframes per video",
    category: "Keyframes",
    lastEditedBy: null,
    lastEditedAt: null,
  },
];

afterEach(() => vi.restoreAllMocks());

describe("IntegritySettingsPage", () => {
  test("renders Hashing and Keyframes categories", async () => {
    vi.spyOn(api, "fetchFunctionConfigs").mockResolvedValue(ROWS);
    render(<IntegritySettingsPage />);
    await waitFor(() => {
      expect(screen.getByText("Hashing")).toBeInTheDocument();
      expect(screen.getByText("Keyframes")).toBeInTheDocument();
      expect(screen.getByText("Hash timeout")).toBeInTheDocument();
      expect(screen.getByText("Keyframes per video")).toBeInTheDocument();
    });
  });

  test("empty configs: shows empty-state", async () => {
    vi.spyOn(api, "fetchFunctionConfigs").mockResolvedValue([]);
    render(<IntegritySettingsPage />);
    await waitFor(() =>
      expect(screen.getByText(/no settings configured/i)).toBeInTheDocument(),
    );
  });

  test("load error: Settings unavailable + Retry", async () => {
    vi.spyOn(api, "fetchFunctionConfigs").mockRejectedValue(new Error("boom"));
    render(<IntegritySettingsPage />);
    await waitFor(() =>
      expect(screen.getByText(/settings unavailable/i)).toBeInTheDocument(),
    );
    expect(screen.getByRole("button", { name: /retry/i })).toBeInTheDocument();
  });

  test("edit + save: mocked PUT fires, UI reflects new value", async () => {
    vi.spyOn(api, "fetchFunctionConfigs").mockResolvedValue(ROWS);
    const saveSpy = vi.spyOn(api, "saveFunctionConfig").mockResolvedValue({
      ...ROWS[1],
      value: 15,
      lastEditedBy: "admin@x",
      lastEditedAt: "2026-04-19T12:00:00Z",
    });
    render(<IntegritySettingsPage />);
    await waitFor(() => screen.getByText("Keyframes per video"));
    const countInput = screen.getAllByRole("spinbutton")[1];
    fireEvent.change(countInput, { target: { value: "15" } });
    fireEvent.click(screen.getAllByRole("button", { name: /save/i })[1]);
    await waitFor(() =>
      expect(saveSpy).toHaveBeenCalledWith("asset-integrity", "keyframe_count", 15),
    );
  });

  test("Restore defaults button resets all settings", async () => {
    vi.spyOn(api, "fetchFunctionConfigs").mockResolvedValue(ROWS);
    const saveSpy = vi
      .spyOn(api, "saveFunctionConfig")
      .mockImplementation(async (scope, key, value) => ({
        ...ROWS.find((r) => r.key === key)!,
        value: value as number,
      }));
    render(<IntegritySettingsPage />);
    await waitFor(() => screen.getByText("Keyframes per video"));
    fireEvent.click(screen.getByRole("button", { name: /restore defaults/i }));
    fireEvent.click(screen.getByRole("button", { name: /confirm/i }));
    await waitFor(() => expect(saveSpy).toHaveBeenCalledTimes(ROWS.length));
  });
});
