# Architecture Decision Records (ADRs)

This directory contains Architecture Decision Records for SpaceHarbor.

## Format

Each ADR follows this structure:

- **Title:** Short name for the decision
- **Status:** Accepted, Deprecated, or Superseded
- **Context:** What problem or situation prompted this decision?
- **Decision:** What was decided?
- **Consequences:** What are the trade-offs and implications?

## Index

| ADR | Title | Status |
|-----|-------|--------|
| [001](001-vast-native-element-handles.md) | Why VAST-native (element handles over file paths) | Accepted |
| [002](002-event-driven-kafka.md) | Why event-driven (Kafka over HTTP polling) | Accepted |
| [003](003-dual-mode-persistence.md) | Why dual-mode persistence (dev fallback strategy) | Accepted |
| [004](004-fastify-over-express.md) | Why Fastify over Express | Accepted |
| [005](005-confluent-kafka-over-kafkajs.md) | Why Confluent Kafka client over kafkajs | Accepted |

## Adding a New ADR

1. Copy the template below.
2. Number sequentially (e.g., `006-your-decision.md`).
3. Submit via PR for team review.

```markdown
# ADR-NNN: Title

**Status:** Proposed | Accepted | Deprecated | Superseded by ADR-XXX
**Date:** YYYY-MM-DD

## Context

## Decision

## Consequences
```
