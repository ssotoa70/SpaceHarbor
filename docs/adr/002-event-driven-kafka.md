# ADR-002: Why Event-Driven (Kafka over HTTP Polling)

**Status:** Accepted
**Date:** 2026-03-02

## Context

SpaceHarbor needs to react to events from multiple sources: file uploads, DataEngine processing completions, approval state changes, and external system notifications. Two primary patterns were considered:

1. **HTTP polling:** Workers and services poll the control-plane REST API at intervals for state changes.
2. **Event streaming:** Services publish and consume events through a durable message broker (Kafka).

VAST Data provides a built-in **Event Broker** that is Kafka-protocol compatible, collocated with the storage and compute layers.

## Decision

SpaceHarbor uses VAST Event Broker (Kafka-compatible) as the primary event transport for all inter-service communication. All state changes publish CloudEvents to Kafka topics. The `VastEventSubscriber` consumes DataEngine completion events and correlates them to SpaceHarbor job records.

HTTP REST endpoints remain for client-facing CRUD operations and operator dashboards.

## Consequences

**Benefits:**
- Durable event delivery — events survive consumer restarts and network partitions.
- Decoupled producers and consumers — new services can subscribe to events without modifying existing ones.
- Event replay from Kafka topic retention for disaster recovery.
- Built-in consumer group coordination for horizontal scaling.
- Immutable event log serves as an audit trail.

**Trade-offs:**
- Eventual consistency — consumers may lag behind producers. Asset state may be momentarily stale.
- Kafka operational complexity — consumer group management, offset tracking, partition rebalancing.
- VAST Event Broker requires VAST local user credentials for SASL authentication (not AD/LDAP).
- Local development requires either a Kafka mock or the `media-worker` dev simulation service.
