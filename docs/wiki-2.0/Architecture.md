# Architecture

> This page redirects to the canonical architecture documentation.

For the full SpaceHarbor architecture, see [VAST Native Architecture](../VAST_NATIVE_ARCHITECTURE.md).

## Quick Overview

SpaceHarbor MVP uses three deployables:
- **control-plane** -- Fastify API server with event-driven asset lifecycle
- **media-worker** -- Python pipeline for proxy generation and metadata extraction (dev simulation only; production uses VAST DataEngine)
- **web-ui** -- React + Vite dashboard

The system is designed as a VAST-native platform where:
- **VAST Database** (Trino) handles persistence for all state
- **VAST Catalog** attaches metadata to immutable Element handles
- **VAST Event Broker** (Kafka-compatible) drives event streaming and workflow triggers
- **VAST DataEngine** provides serverless media processing pipelines

For details on data models, event flows, implementation phases, and deployment architecture, refer to the canonical document above.
