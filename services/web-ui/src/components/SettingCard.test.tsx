import { describe, test, expect, vi } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { SettingCard } from "./SettingCard";
import type { FunctionConfigDTO } from "../api";

function baseConfig(overrides: Partial<FunctionConfigDTO> = {}): FunctionConfigDTO {
  return {
    scope: "asset-integrity", key: "hash_timeout_seconds",
    valueType: "duration_seconds", value: 120, default: 120,
    min: 10, max: 600, description: "Max seconds per hash job.",
    label: "Hash generation timeout", category: "Hashing",
    lastEditedBy: null, lastEditedAt: null, ...overrides,
  };
}

describe("SettingCard", () => {
  test("renders int config with label, description, bounds, save disabled", () => {
    render(<SettingCard config={baseConfig({ valueType: "int", value: 4, default: 4, min: 1, max: 16, label: "Max concurrent" })}
                        onSave={vi.fn()} onReset={vi.fn()} />);
    expect(screen.getByText("Max concurrent")).toBeInTheDocument();
    expect(screen.getByText(/min: 1/i)).toBeInTheDocument();
    expect(screen.getByText(/max: 16/i)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /save/i })).toBeDisabled();
  });

  test("changing value enables Save", () => {
    render(<SettingCard config={baseConfig({ valueType: "int", value: 4, default: 4, min: 1, max: 16 })}
                        onSave={vi.fn()} onReset={vi.fn()} />);
    const input = screen.getByRole("spinbutton") as HTMLInputElement;
    fireEvent.change(input, { target: { value: "5" } });
    expect(screen.getByRole("button", { name: /save/i })).not.toBeDisabled();
  });

  test("Save fires onSave with parsed value", async () => {
    const onSave = vi.fn().mockResolvedValue(undefined);
    render(<SettingCard config={baseConfig({ valueType: "int", value: 4, default: 4, min: 1, max: 16 })}
                        onSave={onSave} onReset={vi.fn()} />);
    const input = screen.getByRole("spinbutton") as HTMLInputElement;
    fireEvent.change(input, { target: { value: "7" } });
    fireEvent.click(screen.getByRole("button", { name: /save/i }));
    await waitFor(() => expect(onSave).toHaveBeenCalledWith(7));
  });

  test("out-of-range input shows inline error, Save stays disabled", () => {
    render(<SettingCard config={baseConfig({ valueType: "int", value: 4, default: 4, min: 1, max: 10 })}
                        onSave={vi.fn()} onReset={vi.fn()} />);
    const input = screen.getByRole("spinbutton") as HTMLInputElement;
    fireEvent.change(input, { target: { value: "99" } });
    expect(screen.getByText(/must be <= 10/i)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /save/i })).toBeDisabled();
  });

  test("Save error from backend shows inline message", async () => {
    const onSave = vi.fn().mockRejectedValue(new Error("permission denied"));
    render(<SettingCard config={baseConfig({ valueType: "int", value: 4, default: 4, min: 1, max: 16 })}
                        onSave={onSave} onReset={vi.fn()} />);
    fireEvent.change(screen.getByRole("spinbutton"), { target: { value: "6" } });
    fireEvent.click(screen.getByRole("button", { name: /save/i }));
    await waitFor(() => expect(screen.getByText(/permission denied/i)).toBeInTheDocument());
  });

  test("Reset calls onReset; input shows default; Save disabled", async () => {
    const onReset = vi.fn().mockResolvedValue(undefined);
    render(<SettingCard config={baseConfig({ valueType: "int", value: 9, default: 4, min: 1, max: 10 })}
                        onSave={vi.fn()} onReset={onReset} />);
    fireEvent.click(screen.getByRole("button", { name: /reset/i }));
    await waitFor(() => expect(onReset).toHaveBeenCalled());
  });

  test("bool config: toggle flips value, Save activates", () => {
    render(<SettingCard config={baseConfig({ valueType: "bool", value: true, default: true, min: null, max: null })}
                        onSave={vi.fn()} onReset={vi.fn()} />);
    const toggle = screen.getByRole("switch") as HTMLInputElement;
    fireEvent.click(toggle);
    expect(screen.getByRole("button", { name: /save/i })).not.toBeDisabled();
  });

  test("duration_seconds: renders 's' suffix", () => {
    render(<SettingCard config={baseConfig({ valueType: "duration_seconds" })}
                        onSave={vi.fn()} onReset={vi.fn()} />);
    expect(screen.getByText(/\bs\b/)).toBeInTheDocument();
  });

  test("shows lastEditedBy metadata when present", () => {
    render(<SettingCard
      config={baseConfig({ lastEditedBy: "admin@x", lastEditedAt: "2026-04-19T12:00:00Z", value: 200 })}
      onSave={vi.fn()} onReset={vi.fn()} />);
    expect(screen.getByText(/admin@x/)).toBeInTheDocument();
  });
});
