import { describe, it, expect } from "vitest";
import { layoutNodes } from "./auto-layout";

const SIZE = { width: 200, height: 90 };

describe("layoutNodes", () => {
  it("places single root at origin", () => {
    const out = layoutNodes(
      [{ id: "a", kind: "start" }],
      [],
      SIZE,
    );
    expect(out[0].position).toEqual({ x: 0, y: 0 });
  });

  it("layers a linear chain horizontally", () => {
    const out = layoutNodes(
      [
        { id: "a", kind: "start" },
        { id: "b", kind: "approval" },
        { id: "c", kind: "end" },
      ],
      [
        { from: "a", to: "b" },
        { from: "b", to: "c" },
      ],
      SIZE,
    );
    const xs = out.map((n) => n.position.x);
    expect(xs[0]).toBeLessThan(xs[1]);
    expect(xs[1]).toBeLessThan(xs[2]);
    // All on layer y=0 since each layer has one node
    for (const n of out) expect(n.position.y).toBe(0);
  });

  it("stacks siblings vertically within a layer", () => {
    const out = layoutNodes(
      [
        { id: "root", kind: "start" },
        { id: "left", kind: "end" },
        { id: "right", kind: "end" },
      ],
      [
        { from: "root", to: "left" },
        { from: "root", to: "right" },
      ],
      SIZE,
    );
    const left = out.find((n) => n.id === "left")!;
    const right = out.find((n) => n.id === "right")!;
    expect(left.position.x).toBe(right.position.x);
    expect(left.position.y).not.toBe(right.position.y);
  });

  it("preserves saved positions verbatim", () => {
    const out = layoutNodes(
      [
        { id: "a", kind: "start", position: { x: 999, y: 777 } },
        { id: "b", kind: "end" },
      ],
      [{ from: "a", to: "b" }],
      SIZE,
    );
    expect(out[0].position).toEqual({ x: 999, y: 777 });
  });

  it("places nodes unreachable from a root in layer 0", () => {
    const out = layoutNodes(
      [
        { id: "a", kind: "start" },
        // Cycle with no root — both nodes get layer 0.
        { id: "x", kind: "approval" },
        { id: "y", kind: "approval" },
      ],
      [
        { from: "x", to: "y" },
        { from: "y", to: "x" },
      ],
      SIZE,
    );
    const x = out.find((n) => n.id === "x")!;
    const y = out.find((n) => n.id === "y")!;
    // x has incoming from y, y has incoming from x — neither is a "root".
    // BFS skips them, then the post-loop fills missing depths as 0.
    expect(x.position.x).toBe(0);
    expect(y.position.x).toBe(0);
  });

  it("handles a diamond DAG with deepest depth winning", () => {
    // a → b → d
    // a → c → d   // d should land at the deeper of (a→b→d, a→c→d) = depth 2
    const out = layoutNodes(
      [
        { id: "a", kind: "start" },
        { id: "b", kind: "approval" },
        { id: "c", kind: "approval" },
        { id: "d", kind: "end" },
      ],
      [
        { from: "a", to: "b" },
        { from: "a", to: "c" },
        { from: "b", to: "d" },
        { from: "c", to: "d" },
      ],
      SIZE,
    );
    const a = out.find((n) => n.id === "a")!;
    const d = out.find((n) => n.id === "d")!;
    expect(d.position.x).toBe(2 * (SIZE.width + 80));
    expect(a.position.x).toBe(0);
  });
});
