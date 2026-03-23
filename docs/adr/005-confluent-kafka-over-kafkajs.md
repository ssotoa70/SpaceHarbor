# ADR-005: Why Confluent Kafka Client over kafkajs

**Status:** Accepted
**Date:** 2026-03-10

## Context

SpaceHarbor's `VastEventSubscriber` consumes events from VAST Event Broker (Kafka-compatible). The initial implementation used `kafkajs`, a pure-JavaScript Kafka client. Two issues emerged:

1. **kafkajs is unmaintained.** The last release was in 2023, with growing CVE backlog and no active maintainers.
2. **Performance.** `kafkajs` reimplements the Kafka protocol in JavaScript. For high-throughput event consumption, a librdkafka-based client offers better performance and protocol compliance.

Alternatives considered:

- **kafkajs:** Pure JS, zero native deps, but unmaintained.
- **@confluentinc/kafka-javascript:** Official Confluent client wrapping librdkafka. Actively maintained, full Kafka protocol support, SASL/SSL out of the box.
- **node-rdkafka:** Community librdkafka binding. Less maintained than Confluent's official client.

## Decision

Migrate from `kafkajs` to `@confluentinc/kafka-javascript` (Confluent's official Node.js Kafka client).

> **Current status:** Migration complete. The codebase uses `@confluentinc/kafka-javascript` as of March 2026. The `VastEventSubscriber` interface abstracts the underlying client, enabling future swaps without changing consumer logic.

## Consequences

**Benefits:**
- Actively maintained with SLA-backed support from Confluent.
- librdkafka-based: proven protocol implementation, better performance, lower latency.
- Native SASL/SCRAM support for VAST Event Broker authentication.
- Handles rebalancing, compression, and batching more robustly than pure-JS alternatives.

**Trade-offs:**
- Native dependency (librdkafka C library). Requires build tools on the CI runner and in Docker images.
- Slightly larger Docker image size due to the native binary.
- API surface differs from kafkajs — consumer/producer code needs migration (one-time cost).
- Pre-built binaries may not be available for all platforms (ARM Linux, Alpine).
