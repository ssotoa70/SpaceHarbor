import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { createLogger, __setLoggerSinkForTests, __resetLoggerSinkForTests } from "./logger";

interface Captured {
  level: "debug" | "info" | "warn" | "error";
  namespace: string;
  message: string;
  context: Record<string, unknown> | undefined;
}

describe("logger", () => {
  let captured: Captured[];

  beforeEach(() => {
    captured = [];
    __setLoggerSinkForTests((entry) => {
      captured.push(entry);
    });
  });

  afterEach(() => {
    __resetLoggerSinkForTests();
    vi.restoreAllMocks();
  });

  it("prefixes messages with the namespace", () => {
    const log = createLogger("metadata/dispatch");
    log.info("hello");
    expect(captured).toHaveLength(1);
    expect(captured[0].namespace).toBe("metadata/dispatch");
    expect(captured[0].message).toBe("hello");
    expect(captured[0].level).toBe("info");
  });

  it("passes structured context through", () => {
    const log = createLogger("metadata/video");
    log.warn("unknown field", { key: "foo", value: 42 });
    expect(captured[0].context).toEqual({ key: "foo", value: 42 });
  });

  it("emits all four levels", () => {
    const log = createLogger("test");
    log.debug("d");
    log.info("i");
    log.warn("w");
    log.error("e");
    expect(captured.map((c) => c.level)).toEqual(["debug", "info", "warn", "error"]);
  });

  it("rejects empty namespace at creation time", () => {
    expect(() => createLogger("")).toThrow(/namespace/);
  });

  it("is silent by default in the test environment (no real console writes)", () => {
    __resetLoggerSinkForTests();
    const spy = vi.spyOn(console, "info").mockImplementation(() => {});
    const log = createLogger("silent-check");
    log.info("should not reach console");
    expect(spy).not.toHaveBeenCalled();
  });
});
