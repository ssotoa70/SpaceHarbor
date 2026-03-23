import { render, screen } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

import { ConnectionIndicator } from "./ConnectionIndicator";

describe("ConnectionIndicator", () => {
  it("renders connected status", () => {
    render(<ConnectionIndicator status="connected" />);
    expect(screen.getByText("Live")).toBeInTheDocument();
    expect(screen.getByRole("status")).toHaveAttribute("aria-label", "Connection: Live");
  });

  it("renders reconnecting status", () => {
    render(<ConnectionIndicator status="reconnecting" />);
    expect(screen.getByText("Reconnecting")).toBeInTheDocument();
  });

  it("renders disconnected status", () => {
    render(<ConnectionIndicator status="disconnected" />);
    expect(screen.getByText("Offline")).toBeInTheDocument();
  });
});

describe("useEventStream", () => {
  let mockEventSource: any;

  beforeEach(() => {
    mockEventSource = vi.fn().mockImplementation(function (this: any) {
      this.close = vi.fn();
      this.onopen = null;
      this.onmessage = null;
      this.onerror = null;
      setTimeout(() => { if (this.onopen) this.onopen(); }, 0);
    });
    (globalThis as any).EventSource = mockEventSource;
  });

  afterEach(() => {
    delete (globalThis as any).EventSource;
  });

  it("creates EventSource with correct URL", async () => {
    // Dynamically import to use our mock
    const { useEventStream } = await import("./useEventStream");
    const { renderHook } = await import("@testing-library/react");

    renderHook(() => useEventStream({ url: "/api/v1/events/stream", onEvent: vi.fn() }));
    expect(mockEventSource).toHaveBeenCalledWith("/api/v1/events/stream");
  });

  it("calls onEvent when message received", async () => {
    const { useEventStream } = await import("./useEventStream");
    const { renderHook, act } = await import("@testing-library/react");

    const onEvent = vi.fn();
    renderHook(() => useEventStream({ url: "/events/stream", onEvent }));

    const instance = mockEventSource.mock.instances[0];
    await act(async () => {
      if (instance.onmessage) {
        instance.onmessage({ data: JSON.stringify({ type: "asset.updated", id: "a1" }) });
      }
    });

    expect(onEvent).toHaveBeenCalledWith({ type: "asset.updated", data: { type: "asset.updated", id: "a1" } });
  });
});
