import "@testing-library/jest-dom/vitest";
import { cleanup } from "@testing-library/react";
import { afterEach } from "vitest";

// Mock ResizeObserver for @tanstack/react-virtual
if (typeof globalThis.ResizeObserver === "undefined") {
  globalThis.ResizeObserver = class ResizeObserver {
    private cb: ResizeObserverCallback;
    constructor(cb: ResizeObserverCallback) { this.cb = cb; }
    observe(target: Element) {
      // Trigger callback so virtualizer re-measures via getBoundingClientRect
      this.cb(
        [{ target, contentRect: target.getBoundingClientRect() } as unknown as ResizeObserverEntry],
        this as unknown as ResizeObserver
      );
    }
    unobserve() {}
    disconnect() {}
  } as unknown as typeof globalThis.ResizeObserver;
}

// jsdom has no layout engine — give elements non-zero dimensions for virtual scroll
Object.defineProperty(HTMLElement.prototype, "clientHeight", { get() { return 800; }, configurable: true });
Object.defineProperty(HTMLElement.prototype, "clientWidth", { get() { return 1200; }, configurable: true });
Object.defineProperty(HTMLElement.prototype, "scrollHeight", { get() { return 2000; }, configurable: true });
Object.defineProperty(HTMLElement.prototype, "offsetHeight", { get() { return 800; }, configurable: true });
Element.prototype.getBoundingClientRect = function () {
  return { x: 0, y: 0, top: 0, left: 0, bottom: 800, right: 1200, width: 1200, height: 800, toJSON() {} } as DOMRect;
};

// Mock IntersectionObserver for lazy thumbnails
if (typeof globalThis.IntersectionObserver === "undefined") {
  globalThis.IntersectionObserver = class IntersectionObserver {
    constructor(private cb: IntersectionObserverCallback) {}
    observe(target: Element) {
      // Immediately report as intersecting for tests
      this.cb([{ isIntersecting: true, target } as IntersectionObserverEntry], this as unknown as IntersectionObserver);
    }
    unobserve() {}
    disconnect() {}
  } as unknown as typeof globalThis.IntersectionObserver;
}

afterEach(() => {
  cleanup();
});
