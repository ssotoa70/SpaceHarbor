import { render, screen, fireEvent } from "@testing-library/react";
import { describe, it, expect, vi } from "vitest";

import { ShortcutProvider, ShortcutHelpModal, useRegisterShortcut } from "./ShortcutProvider";

function TestShortcuts({ onAction }: { onAction: (id: string) => void }) {
  useRegisterShortcut("test-a", {
    key: "a",
    description: "Test action A",
    action: () => onAction("a"),
  });

  useRegisterShortcut("test-escape", {
    key: "Escape",
    description: "Close dialog",
    action: () => onAction("escape"),
  });

  useRegisterShortcut("test-ctrl-s", {
    key: "s",
    modifier: "ctrl",
    description: "Save",
    action: () => onAction("ctrl-s"),
  });

  return <div>shortcuts active</div>;
}

describe("ShortcutProvider", () => {
  it("dispatches keydown to registered shortcut handlers", () => {
    const onAction = vi.fn();
    render(
      <ShortcutProvider>
        <TestShortcuts onAction={onAction} />
      </ShortcutProvider>
    );

    fireEvent.keyDown(window, { key: "a" });
    expect(onAction).toHaveBeenCalledWith("a");
  });

  it("dispatches modifier shortcuts correctly", () => {
    const onAction = vi.fn();
    render(
      <ShortcutProvider>
        <TestShortcuts onAction={onAction} />
      </ShortcutProvider>
    );

    // Without modifier — should NOT trigger ctrl+s
    fireEvent.keyDown(window, { key: "s" });
    expect(onAction).not.toHaveBeenCalledWith("ctrl-s");

    // With modifier
    fireEvent.keyDown(window, { key: "s", ctrlKey: true });
    expect(onAction).toHaveBeenCalledWith("ctrl-s");
  });

  it("suppresses shortcuts when input is focused (no modifier)", () => {
    const onAction = vi.fn();
    render(
      <ShortcutProvider>
        <TestShortcuts onAction={onAction} />
        <input data-testid="text-input" />
      </ShortcutProvider>
    );

    const input = screen.getByTestId("text-input");
    input.focus();

    fireEvent.keyDown(window, { key: "a" });
    expect(onAction).not.toHaveBeenCalledWith("a");
  });

  it("allows modifier shortcuts when input is focused", () => {
    const onAction = vi.fn();
    render(
      <ShortcutProvider>
        <TestShortcuts onAction={onAction} />
        <input data-testid="text-input" />
      </ShortcutProvider>
    );

    const input = screen.getByTestId("text-input");
    input.focus();

    fireEvent.keyDown(window, { key: "s", ctrlKey: true });
    expect(onAction).toHaveBeenCalledWith("ctrl-s");
  });

  it("unregisters shortcuts on component unmount", () => {
    const onAction = vi.fn();
    const { unmount } = render(
      <ShortcutProvider>
        <TestShortcuts onAction={onAction} />
      </ShortcutProvider>
    );

    unmount();

    // Re-render provider without shortcuts
    render(<ShortcutProvider><div>empty</div></ShortcutProvider>);
    fireEvent.keyDown(window, { key: "a" });
    expect(onAction).not.toHaveBeenCalled();
  });
});

describe("ShortcutHelpModal", () => {
  it("shows registered shortcuts when open", () => {
    const onAction = vi.fn();
    render(
      <ShortcutProvider>
        <TestShortcuts onAction={onAction} />
        <ShortcutHelpModal open={true} onClose={vi.fn()} />
      </ShortcutProvider>
    );

    expect(screen.getByText("Keyboard Shortcuts")).toBeInTheDocument();
    expect(screen.getByText("Test action A")).toBeInTheDocument();
    expect(screen.getByText("Save")).toBeInTheDocument();
  });

  it("renders nothing when closed", () => {
    render(
      <ShortcutProvider>
        <ShortcutHelpModal open={false} onClose={vi.fn()} />
      </ShortcutProvider>
    );

    expect(screen.queryByText("Keyboard Shortcuts")).not.toBeInTheDocument();
  });
});
