import { describe, it, expect, beforeEach, vi } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { useSectionCollapse } from "./useSectionCollapse";
import type { SectionDef } from "./types";

const sections: SectionDef[] = [
  { id: "LIBRARY", label: "Library" },
  { id: "ADMIN", label: "Admin", collapsedByDefault: true },
];

// Use a simple in-memory mock for localStorage
const store: Record<string, string> = {};
const localStorageMock = {
  getItem: vi.fn((key: string) => store[key] ?? null),
  setItem: vi.fn((key: string, value: string) => { store[key] = value; }),
  removeItem: vi.fn((key: string) => { delete store[key]; }),
  clear: vi.fn(() => { for (const k of Object.keys(store)) delete store[k]; }),
  get length() { return Object.keys(store).length; },
  key: vi.fn((i: number) => Object.keys(store)[i] ?? null),
};

Object.defineProperty(globalThis, "localStorage", { value: localStorageMock, writable: true });

beforeEach(() => {
  localStorageMock.clear();
  vi.clearAllMocks();
});

describe("useSectionCollapse", () => {
  it("initializes from collapsedByDefault", () => {
    const { result } = renderHook(() => useSectionCollapse(sections));
    expect(result.current.isCollapsed("LIBRARY")).toBe(false);
    expect(result.current.isCollapsed("ADMIN")).toBe(true);
  });

  it("toggles collapse state", () => {
    const { result } = renderHook(() => useSectionCollapse(sections));
    act(() => result.current.toggle("LIBRARY"));
    expect(result.current.isCollapsed("LIBRARY")).toBe(true);
    act(() => result.current.toggle("LIBRARY"));
    expect(result.current.isCollapsed("LIBRARY")).toBe(false);
  });

  it("persists to localStorage", () => {
    const { result } = renderHook(() => useSectionCollapse(sections));
    act(() => result.current.toggle("LIBRARY"));
    expect(localStorageMock.setItem).toHaveBeenCalledWith(
      "ah_nav_collapse",
      expect.stringContaining('"LIBRARY":true'),
    );
  });

  it("restores from localStorage", () => {
    store["ah_nav_collapse"] = JSON.stringify({ ADMIN: false });
    const { result } = renderHook(() => useSectionCollapse(sections));
    // Overrides the collapsedByDefault: true
    expect(result.current.isCollapsed("ADMIN")).toBe(false);
  });

  it("handles unknown section ids gracefully", () => {
    const { result } = renderHook(() => useSectionCollapse(sections));
    expect(result.current.isCollapsed("NONEXISTENT")).toBe(false);
  });
});
