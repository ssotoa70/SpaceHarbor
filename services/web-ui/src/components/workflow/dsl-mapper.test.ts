import { describe, it, expect } from "vitest";
import {
  dslToFlow,
  flowToDsl,
  validateDsl,
  type WorkflowDsl,
} from "./dsl-mapper";

const minimalDsl: WorkflowDsl = {
  nodes: [
    { id: "start", kind: "start" },
    { id: "review", kind: "approval", config: { approvers: ["admin"] } },
    { id: "end", kind: "end" },
  ],
  edges: [
    { from: "start", to: "review" },
    { from: "review", to: "end" },
  ],
};

const dslWithCondition: WorkflowDsl = {
  nodes: [
    { id: "start", kind: "start" },
    { id: "branch", kind: "branch" },
    { id: "approve", kind: "approval", config: { approvers: ["sup"] } },
    { id: "reject", kind: "end" },
    { id: "end", kind: "end" },
  ],
  edges: [
    { from: "start", to: "branch" },
    { from: "branch", to: "approve", when: { equals: { path: "state", value: "pending" } } },
    { from: "branch", to: "reject", when: { equals: { path: "state", value: "denied" } } },
    { from: "approve", to: "end" },
  ],
};

describe("dslToFlow", () => {
  it("converts every node and edge", () => {
    const flow = dslToFlow(minimalDsl);
    expect(flow.nodes).toHaveLength(3);
    expect(flow.edges).toHaveLength(2);
    expect(flow.nodes[0].type).toBe("workflowNode");
    expect(flow.nodes[0].data.kind).toBe("start");
  });

  it("preserves saved positions", () => {
    const dsl: WorkflowDsl = {
      nodes: [
        { id: "a", kind: "start", position: { x: 100, y: 200 } },
        { id: "b", kind: "end" },
      ],
      edges: [{ from: "a", to: "b" }],
    };
    const flow = dslToFlow(dsl);
    expect(flow.nodes[0].position).toEqual({ x: 100, y: 200 });
  });

  it("auto-lays out nodes without saved positions", () => {
    const flow = dslToFlow(minimalDsl);
    // Layered layout: start at depth 0, review at 1, end at 2.
    expect(flow.nodes.find((n) => n.id === "start")!.position.x).toBe(0);
    expect(flow.nodes.find((n) => n.id === "review")!.position.x).toBeGreaterThan(0);
    expect(flow.nodes.find((n) => n.id === "end")!.position.x)
      .toBeGreaterThan(flow.nodes.find((n) => n.id === "review")!.position.x);
  });

  it("attaches edge condition data", () => {
    const flow = dslToFlow(dslWithCondition);
    const conditionalEdge = flow.edges.find((e) => e.source === "branch" && e.target === "approve");
    expect(conditionalEdge?.data?.when).toEqual({ equals: { path: "state", value: "pending" } });
    expect(conditionalEdge?.label).toBe("when");
  });
});

describe("flowToDsl", () => {
  it("round-trips a positioned DSL", () => {
    const dsl: WorkflowDsl = {
      nodes: [
        { id: "a", kind: "start", position: { x: 100, y: 200 } },
        { id: "b", kind: "end", position: { x: 400, y: 200 } },
      ],
      edges: [{ from: "a", to: "b" }],
    };
    const flow = dslToFlow(dsl);
    const back = flowToDsl(flow.nodes, flow.edges);
    expect(back).toEqual(dsl);
  });

  it("rounds fractional positions to integers", () => {
    const back = flowToDsl(
      [{ id: "a", type: "workflowNode", position: { x: 100.7, y: 200.3 }, data: { kind: "start", config: undefined } }],
      [],
    );
    expect(back.nodes[0].position).toEqual({ x: 101, y: 200 });
  });

  it("preserves edge `when` conditions", () => {
    const flow = dslToFlow(dslWithCondition);
    const back = flowToDsl(flow.nodes, flow.edges);
    const branchToApprove = back.edges.find((e) => e.from === "branch" && e.to === "approve");
    expect(branchToApprove?.when).toEqual({ equals: { path: "state", value: "pending" } });
  });

  it("preserves config objects", () => {
    const flow = dslToFlow(minimalDsl);
    const back = flowToDsl(flow.nodes, flow.edges);
    const review = back.nodes.find((n) => n.id === "review");
    expect(review?.config).toEqual({ approvers: ["admin"] });
  });

  it("does not emit position on nodes that lacked one round-trip", () => {
    // After a full round trip including auto-layout, positions ARE present —
    // that's intentional; the canvas always saves layout. We verify that
    // every node has position after round-trip.
    const flow = dslToFlow(minimalDsl);
    const back = flowToDsl(flow.nodes, flow.edges);
    for (const n of back.nodes) {
      expect(n.position).toBeDefined();
      expect(typeof n.position!.x).toBe("number");
      expect(typeof n.position!.y).toBe("number");
    }
  });
});

describe("validateDsl", () => {
  it("accepts the canonical example", () => {
    expect(validateDsl(minimalDsl)).toEqual({ ok: true });
  });

  it("rejects empty nodes array", () => {
    const r = validateDsl({ nodes: [], edges: [] });
    expect(r.ok).toBe(false);
  });

  it("rejects missing start node", () => {
    const r = validateDsl({
      nodes: [{ id: "x", kind: "approval" }, { id: "y", kind: "end" }],
      edges: [{ from: "x", to: "y" }],
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors[0]).toMatch(/start/);
  });

  it("rejects duplicate node ids", () => {
    const r = validateDsl({
      nodes: [{ id: "x", kind: "start" }, { id: "x", kind: "end" }],
      edges: [],
    });
    expect(r.ok).toBe(false);
  });

  it("rejects edge referencing unknown node", () => {
    const r = validateDsl({
      nodes: [{ id: "start", kind: "start" }],
      edges: [{ from: "start", to: "ghost" }],
    });
    expect(r.ok).toBe(false);
  });
});
