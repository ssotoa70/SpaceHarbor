/**
 * Workflow engine — driver + handler registry.
 *
 * DSL shape:
 *   {
 *     "nodes": [
 *       {"id": "start", "kind": "start"},
 *       {"id": "approve", "kind": "approval", "config": {"approvers": ["user:sup@..."]}},
 *       {"id": "notify", "kind": "http", "config": {"url": "...", "method": "POST"}},
 *       {"id": "end", "kind": "end"}
 *     ],
 *     "edges": [
 *       {"from": "start", "to": "approve"},
 *       {"from": "approve", "to": "notify", "when": {"equals": {"path": "state", "value": "approved"}}},
 *       {"from": "notify", "to": "end"}
 *     ]
 *   }
 *
 * Handler registry: each node kind has an `execute(instance, node, ctx)`
 * function that returns one of:
 *   { action: "advance", nextNodeId: string, patch?: Record<string, unknown> }
 *     → engine writes a transition row and moves to nextNodeId
 *   { action: "wait", reason?: string }
 *     → engine marks the instance waiting; external event (approval,
 *       webhook, manual transition) advances it later
 *   { action: "complete" }
 *     → engine marks instance completed
 *   { action: "fail", error: string }
 *     → engine marks instance failed with error
 *
 * Plan reference: docs/plans/2026-04-16-mam-readiness-phase1.md
 */

import type { PersistenceAdapter, WorkflowDefinitionRecord, WorkflowInstanceRecord } from "../persistence/types.js";

export type NodeKind =
  | "start"
  | "end"
  | "approval"
  | "http"
  | "script"
  | "branch"
  | "wait_for_event"
  | "enqueue_job";

export interface WorkflowNode {
  id: string;
  kind: NodeKind;
  config?: Record<string, unknown>;
}

export interface WorkflowEdge {
  from: string;
  to: string;
  when?: Record<string, unknown>;
}

export interface WorkflowDsl {
  nodes: WorkflowNode[];
  edges: WorkflowEdge[];
}

export interface HandlerContext {
  instance: WorkflowInstanceRecord;
  definition: WorkflowDefinitionRecord;
  dsl: WorkflowDsl;
  persistence: PersistenceAdapter;
  correlationId: string;
}

export type HandlerResult =
  | { action: "advance"; nextNodeId: string; patch?: Record<string, unknown> }
  | { action: "wait"; reason?: string }
  | { action: "complete" }
  | { action: "fail"; error: string };

export type NodeHandler = (node: WorkflowNode, ctx: HandlerContext) => Promise<HandlerResult> | HandlerResult;

// ---------------------------------------------------------------------------
// Handler registry
// ---------------------------------------------------------------------------

const handlers: Partial<Record<NodeKind, NodeHandler>> = {};

export function registerHandler(kind: NodeKind, handler: NodeHandler): void {
  handlers[kind] = handler;
}

export function getHandler(kind: NodeKind): NodeHandler | undefined {
  return handlers[kind];
}

// ---------------------------------------------------------------------------
// Default handlers
// ---------------------------------------------------------------------------

registerHandler("start", (_node, ctx) => {
  const next = nextEdge(ctx.dsl, _node.id, ctx.instance);
  if (!next) return { action: "fail", error: `No outgoing edge from start node ${_node.id}` };
  return { action: "advance", nextNodeId: next.to };
});

registerHandler("end", () => ({ action: "complete" }));

registerHandler("approval", (_node) => {
  // Approval is always a wait — external human decision transitions the
  // instance via POST /workflows/instances/:id/transition.
  return { action: "wait", reason: `waiting on approval at node ${_node.id}` };
});

registerHandler("wait_for_event", (_node) => {
  return { action: "wait", reason: `waiting for external event at node ${_node.id}` };
});

registerHandler("http", async (node, ctx) => {
  const config = (node.config ?? {}) as { url?: string; method?: string; headers?: Record<string, string>; body?: unknown };
  if (!config.url) return { action: "fail", error: "http node missing config.url" };
  try {
    const res = await fetch(config.url, {
      method: config.method ?? "POST",
      headers: { "content-type": "application/json", ...(config.headers ?? {}) },
      body: config.body !== undefined ? JSON.stringify(config.body) : undefined,
      signal: AbortSignal.timeout(15_000),
    });
    if (!res.ok) return { action: "fail", error: `HTTP ${res.status}` };
  } catch (err) {
    return { action: "fail", error: err instanceof Error ? err.message : String(err) };
  }
  const next = nextEdge(ctx.dsl, node.id, ctx.instance);
  if (!next) return { action: "complete" };
  return { action: "advance", nextNodeId: next.to };
});

registerHandler("branch", (node, ctx) => {
  // Evaluate each outgoing edge's `when` against the instance's context;
  // take the first that matches. Default edge has `when` absent.
  const outgoing = ctx.dsl.edges.filter((e) => e.from === node.id);
  const context = safeJsonParse<Record<string, unknown>>(ctx.instance.contextJson) ?? {};
  for (const edge of outgoing) {
    if (!edge.when) continue;
    if (evaluateWhen(edge.when, context)) {
      return { action: "advance", nextNodeId: edge.to };
    }
  }
  // Fallback to the first edge without `when`
  const defaultEdge = outgoing.find((e) => !e.when);
  if (defaultEdge) return { action: "advance", nextNodeId: defaultEdge.to };
  return { action: "fail", error: `branch ${node.id} found no matching outgoing edge` };
});

registerHandler("enqueue_job", (_node) => {
  // Phase 3 — needs job queue plumbing for arbitrary payloads.
  return { action: "wait", reason: "enqueue_job handler is a stub; advance manually via transition API" };
});

registerHandler("script", (_node) => {
  // Phase 3 — needs isolated-vm.
  return { action: "wait", reason: "script handler requires isolated-vm sandbox (Phase 3)" };
});

// ---------------------------------------------------------------------------
// Engine driver
// ---------------------------------------------------------------------------

export async function runWorkflowStep(
  persistence: PersistenceAdapter,
  instanceId: string,
  correlationId: string,
  externalEvent?: { type: string; actor?: string; payload?: Record<string, unknown> },
): Promise<WorkflowInstanceRecord | null> {
  const instance = await persistence.getWorkflowInstance(instanceId);
  if (!instance) return null;
  if (instance.state === "completed" || instance.state === "failed" || instance.state === "cancelled") {
    return instance;
  }

  const definition = await persistence.getWorkflowDefinition(instance.definitionId);
  if (!definition) return instance;
  const dsl = safeJsonParse<WorkflowDsl>(definition.dslJson);
  if (!dsl || !Array.isArray(dsl.nodes)) return instance;

  const node = dsl.nodes.find((n) => n.id === instance.currentNodeId);
  if (!node) {
    return persistence.updateWorkflowInstance(
      instanceId,
      { state: "failed", lastError: `current_node_id "${instance.currentNodeId}" not found in DSL`, currentNodeId: instance.currentNodeId, contextJson: instance.contextJson, completedAt: new Date().toISOString() },
      { correlationId, now: new Date().toISOString() },
    );
  }

  const handler = getHandler(node.kind);
  if (!handler) {
    return persistence.updateWorkflowInstance(
      instanceId,
      { state: "failed", lastError: `no handler registered for node kind "${node.kind}"`, currentNodeId: instance.currentNodeId, contextJson: instance.contextJson, completedAt: new Date().toISOString() },
      { correlationId, now: new Date().toISOString() },
    );
  }

  // If there's an external event (e.g. approval decision), merge it into context
  let context = safeJsonParse<Record<string, unknown>>(instance.contextJson) ?? {};
  if (externalEvent) {
    context = { ...context, lastEvent: externalEvent };
  }

  const ctx: HandlerContext = { instance, definition, dsl, persistence, correlationId };
  const result = await handler(node, ctx);
  const now = new Date().toISOString();

  switch (result.action) {
    case "advance":
      await persistence.recordWorkflowTransition(
        { instanceId, fromNodeId: instance.currentNodeId, toNodeId: result.nextNodeId, eventType: externalEvent?.type, actor: externalEvent?.actor, payloadJson: externalEvent?.payload ? JSON.stringify(externalEvent.payload) : undefined },
        { correlationId, now },
      );
      return persistence.updateWorkflowInstance(
        instanceId,
        {
          currentNodeId: result.nextNodeId,
          state: "running",
          contextJson: JSON.stringify({ ...context, ...(result.patch ?? {}) }),
          completedAt: null,
          lastError: null,
        },
        { correlationId, now },
      );
    case "wait":
      return persistence.updateWorkflowInstance(
        instanceId,
        {
          currentNodeId: instance.currentNodeId,
          state: "running",
          contextJson: JSON.stringify({ ...context, waitReason: result.reason ?? null }),
          completedAt: null,
          lastError: null,
        },
        { correlationId, now },
      );
    case "complete":
      return persistence.updateWorkflowInstance(
        instanceId,
        {
          currentNodeId: instance.currentNodeId,
          state: "completed",
          contextJson: JSON.stringify(context),
          completedAt: now,
          lastError: null,
        },
        { correlationId, now },
      );
    case "fail":
      return persistence.updateWorkflowInstance(
        instanceId,
        {
          currentNodeId: instance.currentNodeId,
          state: "failed",
          contextJson: JSON.stringify(context),
          completedAt: now,
          lastError: result.error,
        },
        { correlationId, now },
      );
  }
}

/**
 * Drive the workflow synchronously until it hits a wait/complete/fail boundary.
 * Caps at 32 iterations to prevent infinite loops from bad DSL.
 *
 * "Wait boundary" detection: the `wait` action leaves currentNodeId unchanged
 * (the engine writes the same node back). We detect it by comparing the node
 * id before vs after each step — if it didn't advance, we stop.
 */
export async function runWorkflowToBoundary(
  persistence: PersistenceAdapter,
  instanceId: string,
  correlationId: string,
  maxSteps = 32,
): Promise<WorkflowInstanceRecord | null> {
  let instance: WorkflowInstanceRecord | null = null;
  let prevNodeId: string | null = null;

  for (let i = 0; i < maxSteps; i++) {
    // Snapshot node id BEFORE the step so we can detect wait (no advance).
    const beforeStep = await persistence.getWorkflowInstance(instanceId);
    if (!beforeStep) return null;
    const beforeNodeId = beforeStep.currentNodeId;

    instance = await runWorkflowStep(persistence, instanceId, correlationId);
    if (!instance) return null;
    if (instance.state === "completed" || instance.state === "failed" || instance.state === "cancelled") break;

    // Wait = node did not advance this step.
    if (instance.currentNodeId === beforeNodeId) break;

    // Safety: detect oscillation A→B→A which would imply a DSL bug.
    if (prevNodeId !== null && prevNodeId === instance.currentNodeId) break;
    prevNodeId = beforeNodeId;
  }
  return instance;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function nextEdge(dsl: WorkflowDsl, fromNodeId: string, instance: WorkflowInstanceRecord): WorkflowEdge | undefined {
  const context = safeJsonParse<Record<string, unknown>>(instance.contextJson) ?? {};
  const outgoing = dsl.edges.filter((e) => e.from === fromNodeId);
  for (const edge of outgoing) {
    if (!edge.when) return edge;
    if (evaluateWhen(edge.when, context)) return edge;
  }
  return outgoing[0];
}

function evaluateWhen(cond: Record<string, unknown>, context: Record<string, unknown>): boolean {
  if ("equals" in cond && cond.equals && typeof cond.equals === "object") {
    const { path, value } = cond.equals as { path: string; value: unknown };
    return readPath(context, path) === value;
  }
  if ("and" in cond && Array.isArray(cond.and)) {
    return cond.and.every((c) => evaluateWhen(c as Record<string, unknown>, context));
  }
  if ("or" in cond && Array.isArray(cond.or)) {
    return cond.or.some((c) => evaluateWhen(c as Record<string, unknown>, context));
  }
  return false;
}

function readPath(root: Record<string, unknown>, path: string): unknown {
  const parts = path.split(".");
  let cur: unknown = root;
  for (const p of parts) {
    if (cur === null || typeof cur !== "object") return undefined;
    cur = (cur as Record<string, unknown>)[p];
  }
  return cur;
}

function safeJsonParse<T>(json: string | null | undefined): T | null {
  if (!json) return null;
  try { return JSON.parse(json) as T; } catch { return null; }
}
