# SpaceHarbor Wiki

Welcome to SpaceHarbor—a VAST-native Media Asset Management (MAM) platform for post-production and VFX studios.

## What is SpaceHarbor?

SpaceHarbor provides a complete asset lifecycle management system built on the VAST Data platform. It handles media ingest, automated metadata extraction, multi-stage approval workflows, and seamless integration with VFX pipelines. Whether you're ingesting dailies, managing versioning, or coordinating approvals across teams, SpaceHarbor automates the heavy lifting.

### Key Features

- **Asset Ingest**: Rapidly ingest media files with automatic metadata extraction (format, duration, resolution, codec)
- **Smart Proxy Generation**: Automatic creation of lightweight preview formats without manual encoding
- **Approval Workflows**: Flexible multi-stage review and approval processes with audit trails
- **VFX Hierarchy Support**: Organize assets by project, sequence, shot, and version
- **Real-Time Events**: Live status updates via WebSocket and Kafka event streaming
- **VAST-Native**: Leverages VAST platform services (DataEngine, Event Broker, Database) for scalability

## Documentation Structure

### Getting Started
- **[Quick Start](Quick-Start.md)** — Set up and run SpaceHarbor in 5 minutes
- **[Installation Guide](Installation-Guide.md)** — Detailed setup for development or production

### Configuration & Deployment
- **[Deployment Guide](Deployment-Guide.md)** — Production deployment with environment setup
- **[Configuration Guide](Configuration-Guide.md)** — Platform settings (database, event broker, storage)
- **[Identity and Access](Identity-and-Access.md)** — Authentication, RBAC, and user provisioning

### Architecture & Design
- **[Architecture Overview](Architecture.md)** — System design, component relationships, data flow
- **[API Reference](API-Reference.md)** — Complete endpoint documentation with examples
- **[Pipeline and Functions](Pipeline-and-Functions.md)** — DataEngine function library and orchestration

### Operations
- **[Troubleshooting](Troubleshooting.md)** — Common issues and solutions
- **[Monitoring and Observability](Monitoring.md)** — Health checks, metrics, and alerting
- **[License and Notices](License-and-Notices.md)** — Licensing and third-party attributions

## Quick Links

### For First-Time Users
1. Review [Architecture Overview](Architecture.md) to understand how SpaceHarbor works
2. Follow [Quick Start](Quick-Start.md) to get a local instance running
3. Try ingesting your first asset via the Web UI

### For Operators
1. Review [Deployment Guide](Deployment-Guide.md) for production setup
2. Configure [Identity and Access](Identity-and-Access.md) for your team
3. Set up [Monitoring and Observability](Monitoring.md) for operational visibility

### For Developers
1. Check [API Reference](API-Reference.md) for endpoint documentation
2. Review [Architecture Overview](Architecture.md) for design principles
3. Explore [Pipeline and Functions](Pipeline-and-Functions.md) for extending processing

### For System Administrators
1. Follow [Installation Guide](Installation-Guide.md) for initial setup
2. Review [Configuration Guide](Configuration-Guide.md) for VAST platform integration
3. Set up [Identity and Access](Identity-and-Access.md) for user management
4. Configure [Monitoring and Observability](Monitoring.md) for alerting

## Architecture at a Glance

SpaceHarbor consists of three integrated layers:

**Client Layer** — Web UI and optional DCC (Desktop Content Creation) plugins for direct ingest from Maya, Nuke, and Houdini.

**Control Plane** — Fastify-based API server that orchestrates workflows, manages approvals, and integrates with VAST platform services.

**VAST Platform** — Underlying services including:
- VAST Database (Trino) for persistent state
- VAST Event Broker (Kafka) for event-driven workflows
- VAST DataEngine for serverless media processing
- VAST Element Store for media file storage

See [Architecture Overview](Architecture.md) for detailed diagrams and component descriptions.

## Core Concepts

### Element Handles
Files in VAST are identified by immutable element handles (e.g., `elem_abc123xyz`), not file paths. This enables metadata to remain attached to files even as they're moved, copied, or cloned—solving the "broken links" problem common in traditional MAMs.

### Event-Driven Workflows
All state changes propagate through Kafka event streams. When a file is ingested, DataEngine processes it, completion events trigger approvals, and reviewers' decisions automatically update asset status.

### Dual-Mode Persistence
SpaceHarbor adapts to your environment:
- **Local Mode** (development): In-memory storage, no VAST cluster required
- **Production Mode**: VAST Database (Trino) for durability and scale

### Approval Workflows
Assets flow through configurable approval stages (ingest → processing → review → approval). Reviewers annotate, propose revisions, and make decisions. Audit trails track every action.

## Getting Help

- **Configuration Issues?** → See [Configuration Guide](Configuration-Guide.md)
- **Deployment Problems?** → See [Deployment Guide](Deployment-Guide.md)
- **API Questions?** → See [API Reference](API-Reference.md)
- **Can't Find an Asset?** → See [Troubleshooting](Troubleshooting.md)
- **Need Auth Setup?** → See [Identity and Access](Identity-and-Access.md)

## System Requirements

- VAST Data cluster (or local development mode)
- Docker + Docker Compose (for containerized deployment)
- Node.js 18+ (for control-plane)
- Python 3.11+ (for optional media-worker simulation)
- Modern web browser (for Web UI)

## License

SpaceHarbor is released under the terms specified in [License and Notices](License-and-Notices.md).

---

**Latest Update:** March 2026
**Status:** Production Ready
