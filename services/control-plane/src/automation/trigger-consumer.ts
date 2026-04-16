/**
 * TriggerConsumer — subscribes to the internal event bus and fires any
 * enabled triggers whose event_selector matches the incoming event.
 *
 * Event-selector matching:
 *   exact     "version.approved"       matches only this type
 *   wildcard  "version.*"              matches version.approved, version.published, ...
 *   catchall  "*"                      matches every event
 *
 * Condition evaluation (trigger.condition_json):
 *   Optional. If present, must be a JSONLogic-style condition evaluated
 *   against the event payload. Empty/absent conditions always match.
 *   For Phase 2 we support a minimal dialect — equality on a single path:
 *     { "equals": { "path": "data.status", "value": "approved" } }
 *   Future: full JSONLogic engine (or isolated-vm script as a condition).
 *
 * Action dispatch:
 *   http_call     → delivers via outbound webhook machinery (with HMAC sign)
 *   post_event    → publishes a new synthetic event (for cascade triggers)
 *   run_workflow  → starts a workflow instance
 *   enqueue_job   → stub (Phase 3)
 *   run_script    → stub (Phase 3 — needs isolated-vm)
 *
 * Plan reference: docs/plans/2026-04-16-mam-readiness-phase1.md
 */

import { randomUUID } from "node:crypto";
import type { PersistenceAdapter, TriggerRecord } from "../persistence/types.js";
import { eventBus, type PlatformEvent } from "../events/bus.js";
import { deliverWebhook } from "./outbound-webhook.js";
import { triggerFiredTotal } from "../infra/metrics.js";

export class TriggerConsumer {
  private unsubscribe: (() => void) | null = null;

  constructor(private readonly persistence: PersistenceAdapter) {}

  start(): void {
    if (this.unsubscribe) return;
    this.unsubscribe = eventBus.subscribe("*", async (event) => {
      try {
        await this.handleEvent(event);
      } catch (err) {
        // Individual trigger failures must not block other triggers
        console.error("[trigger-consumer] error processing event", event.type, err);
      }
    });
  }

  stop(): void {
    if (this.unsubscribe) {
      this.unsubscribe();
      this.unsubscribe = null;
    }
  }

  private async handleEvent(event: PlatformEvent): Promise<void> {
    const triggers = await this.persistence.listTriggers({ enabled: true });
    for (const trigger of triggers) {
      if (!matchesSelector(event.type, trigger.eventSelector)) continue;
      if (!evaluateCondition(event, trigger.conditionJson)) continue;
      await this.fireTrigger(trigger, event);
    }
  }

  private async fireTrigger(trigger: TriggerRecord, event: PlatformEvent): Promise<void> {
    const ctx = { correlationId: event.correlationId ?? `trigger-${trigger.id}`, now: new Date().toISOString() };
    try {
      await this.persistence.recordTriggerFire(trigger.id, ctx);
      triggerFiredTotal.inc({ action_kind: trigger.actionKind });

      switch (trigger.actionKind) {
        case "http_call": {
          const config = safeJsonParse<{ webhookId?: string; url?: string }>(trigger.actionConfigJson) ?? {};
          if (!config.webhookId) {
            // Inline URL form — no signing, fire-and-forget (discouraged; use webhookId for audit trail)
            if (!config.url) return;
            await deliverWebhookInline(config.url, event);
            return;
          }
          const webhook = await this.persistence.getWebhookEndpoint(config.webhookId);
          if (!webhook || webhook.revokedAt) return;
          await deliverWebhook(this.persistence, webhook, event, trigger.id);
          return;
        }
        case "post_event": {
          const config = safeJsonParse<{ type: string; data?: Record<string, unknown> }>(trigger.actionConfigJson);
          if (!config?.type) return;
          eventBus.publish({
            type: config.type,
            subject: event.subject,
            data: config.data ?? event.data,
            actor: event.actor,
            correlationId: event.correlationId,
          });
          return;
        }
        case "run_workflow": {
          const config = safeJsonParse<{ workflowName: string; contextOverrides?: Record<string, unknown> }>(trigger.actionConfigJson);
          if (!config?.workflowName) return;
          const definition = await this.persistence.getWorkflowDefinitionByName(config.workflowName);
          if (!definition || !definition.enabled) return;
          const dsl = safeJsonParse<{ nodes: Array<{ id: string; kind: string }> }>(definition.dslJson);
          const startNode = dsl?.nodes?.find((n) => n.kind === "start");
          if (!startNode) return;
          await this.persistence.createWorkflowInstance(
            {
              definitionId: definition.id,
              definitionVersion: definition.version,
              currentNodeId: startNode.id,
              contextJson: JSON.stringify({ event, ...(config.contextOverrides ?? {}) }),
              startedBy: `trigger:${trigger.id}`,
              parentEntityType: event.subject?.split(":")[0],
              parentEntityId: event.subject?.split(":")[1],
            },
            ctx,
          );
          // Kick the engine on the new instance (best-effort, fire-and-forget)
          eventBus.publish({
            type: "workflow.started",
            subject: event.subject,
            data: { workflowName: config.workflowName, triggerId: trigger.id },
            actor: event.actor,
            correlationId: event.correlationId,
          });
          return;
        }
        case "enqueue_job":
        case "run_script":
          // Phase 3 — needs worker plumbing and isolated-vm sandbox
          return;
      }
    } catch (err) {
      console.error(`[trigger-consumer] trigger ${trigger.id} (${trigger.name}) failed`, err);
    }
  }
}

// ---------------------------------------------------------------------------
// Selector + condition helpers (exported so the unit tests can hit them)
// ---------------------------------------------------------------------------

export function matchesSelector(eventType: string, selector: string): boolean {
  if (selector === "*") return true;
  if (selector === eventType) return true;
  if (selector.endsWith(".*")) {
    return eventType.startsWith(selector.slice(0, -1));
  }
  return false;
}

export function evaluateCondition(event: PlatformEvent, conditionJson: string | null): boolean {
  if (!conditionJson) return true;
  const condition = safeJsonParse<Record<string, unknown>>(conditionJson);
  if (!condition) return false;

  // Minimal JSONLogic-style: { equals: { path, value } }
  if ("equals" in condition && condition.equals && typeof condition.equals === "object") {
    const { path, value } = condition.equals as { path: string; value: unknown };
    return readPath(event as unknown as Record<string, unknown>, path) === value;
  }
  // Minimal: { and: [<cond1>, <cond2>] } — each element is recursively evaluated
  if ("and" in condition && Array.isArray(condition.and)) {
    return condition.and.every((c) => evaluateCondition(event, JSON.stringify(c)));
  }
  if ("or" in condition && Array.isArray(condition.or)) {
    return condition.or.some((c) => evaluateCondition(event, JSON.stringify(c)));
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

// Inline fire-and-forget delivery (no HMAC signing, no retry, no log row).
// Discouraged — use `deliverWebhook` with a registered webhookId for audit
// trails. Kept for simple "fire an HTTP call" triggers where auditability
// is not required.
async function deliverWebhookInline(url: string, event: PlatformEvent): Promise<void> {
  try {
    await fetch(url, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-spaceharbor-event-id": randomUUID(),
        "x-spaceharbor-event-type": event.type,
      },
      body: JSON.stringify(event),
    });
  } catch {
    // best-effort — no retry
  }
}
