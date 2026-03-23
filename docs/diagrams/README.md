# Architecture Diagrams

All diagrams use Mermaid syntax and reflect the actual implemented architecture as of 2026-03-22. Aspirational or planned features are explicitly marked.

| File | Type | Description |
|------|------|-------------|
| [logical-architecture.md](logical-architecture.md) | `graph TD` | Full component map: Web UI, Control Plane, VAST platform services, DataEngine function containers, and the dev-only Media Worker. |
| [storage-topology.md](storage-topology.md) | `graph LR` | Storage access patterns: Protocol Resolver (NFS/SMB/S3), S3 presigned URLs, VAST Catalog indexed-column queries, and element handle resolution. |
| [identity-auth-flow.md](identity-auth-flow.md) | `sequenceDiagram` | Authentication flows: local scrypt auth, JWT issuance, OIDC/PKCE device flow, API key auth, RBAC shadow mode, SCIM user provisioning, and the AD/LDAP planned-but-not-implemented note. |
| [ingest-pipeline.md](ingest-pipeline.md) | `sequenceDiagram` | End-to-end ingest: `.ready` sentinel detection, ScannerFunction, control-plane asset creation, VAST element trigger, DataEngine function chain, Event Broker completion events, VastEventSubscriber, and approval workflow. |
| [data-query-flow.md](data-query-flow.md) | `graph TD` | Persistence layer: VastPersistenceAdapter and LocalAdapter, TrinoClient REST calls, the 14-migration / 30+ table schema in VastDB, and VAST Catalog indexed-column queries. |

## Rendering

These diagrams render natively in GitHub, GitLab, and any Markdown viewer with Mermaid support. For local preview use the [Mermaid Live Editor](https://mermaid.live) or a VS Code extension such as "Markdown Preview Mermaid Support".
