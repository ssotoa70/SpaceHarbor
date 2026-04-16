/**
 * Internal event bus — an in-process publisher that triggers and workflows
 * subscribe to.
 *
 * For Phase 2 we keep this in-process using Node's EventEmitter. The existing
 * VAST Event Broker (Kafka) subscriber in `events/vast-event-subscriber.ts`
 * handles cross-process events; this bus is for control-plane-local events
 * like `custom_field.defined`, `version.published`, `workflow.started`, etc.
 *
 * Phase 3 will unify the two paths behind a single publish API that routes
 * synchronous in-process subscribers + optional Kafka fan-out for multi-node
 * deployments. For Phase 2 we prioritize getting triggers firing on real
 * events over cross-node fan-out.
 *
 * Event shape:
 *   {
 *     type: "version.approved",
 *     subject: "version:<id>" | "asset:<id>" | ...,
 *     data: { ... },
 *     actor: "user@domain" | null,
 *     correlationId: "req-XX",
 *     at: "2026-04-16T18:00:00Z"
 *   }
 *
 * Plan reference: docs/plans/2026-04-16-mam-readiness-phase1.md
 */

import { EventEmitter } from "node:events";

export interface PlatformEvent<TData = unknown> {
  type: string;
  subject?: string;
  data: TData;
  actor?: string | null;
  correlationId?: string;
  at: string;
}

export type EventHandler = (event: PlatformEvent) => Promise<void> | void;

class PlatformEventBus {
  private readonly emitter = new EventEmitter();

  constructor() {
    // Generous max listeners — triggers + workflow engine can easily add 50+
    this.emitter.setMaxListeners(200);
  }

  /**
   * Publish an event. All matching subscribers are invoked asynchronously;
   * subscriber errors do NOT propagate to the caller (they are logged into
   * the subscriber's own error handler).
   */
  publish(event: Omit<PlatformEvent, "at"> & { at?: string }): void {
    const full: PlatformEvent = { ...event, at: event.at ?? new Date().toISOString() };
    // "*" subscribers see every event; type-specific subscribers see a subset
    this.emitter.emit("*", full);
    this.emitter.emit(full.type, full);
  }

  /**
   * Subscribe to events whose `type` matches `pattern`. Patterns:
   *   - exact:  "version.approved"        (matches only this type)
   *   - wildcard: "version.*"             (matches version.approved, version.published, ...)
   *   - catchall: "*"                     (matches every event)
   */
  subscribe(pattern: string, handler: EventHandler): () => void {
    if (pattern === "*" || pattern.endsWith(".*")) {
      const wrapper = (event: PlatformEvent): void => {
        if (pattern === "*" || event.type.startsWith(pattern.slice(0, -1))) {
          void Promise.resolve(handler(event)).catch(() => {
            // swallowed — subscriber is responsible for its own error handling
          });
        }
      };
      this.emitter.on("*", wrapper);
      return () => this.emitter.off("*", wrapper);
    }
    const wrapper = (event: PlatformEvent): void => {
      void Promise.resolve(handler(event)).catch(() => {});
    };
    this.emitter.on(pattern, wrapper);
    return () => this.emitter.off(pattern, wrapper);
  }

  /** Remove every subscriber — primarily used by tests. */
  reset(): void {
    this.emitter.removeAllListeners();
  }
}

export const eventBus = new PlatformEventBus();
