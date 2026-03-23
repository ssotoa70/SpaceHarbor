# SpaceHarbor Wiki 2.0

This folder seeds the GitHub Wiki with the core page structure for operational and product documentation.

## Purpose

- Keep deep documentation versioned, discoverable, and reviewable.
- Separate execution docs from lightweight README onboarding.

## Page Map

| Page | Description |
|------|-------------|
| [Getting-Started](./Getting-Started.md) | Quick start and link to the full [Deployment Guide](../deployment-guide.md) |
| [Architecture](./Architecture.md) | Overview and link to the full [VAST Native Architecture](../VAST_NATIVE_ARCHITECTURE.md) |
| [API-Reference](./API-Reference.md) | Route summary and link to the full [API Contracts](../api-contracts.md) |
| [Operations-Runbook](./Operations-Runbook.md) | Health checks, recovery, alert thresholds, escalation matrix |
| [Security-and-Compliance](./Security-and-Compliance.md) | Current security baseline, VAST mode security, and next priorities |
| [Release-Process](./Release-Process.md) | Versioning, SLO gates, canary promotion, go/no-go checklist |

## Canonical Documentation

Several wiki pages redirect to canonical docs maintained in the repository root:

| Canonical Doc | Location | Covers |
|---------------|----------|--------|
| API Contracts | [`docs/api-contracts.md`](../api-contracts.md) | Complete API reference with schemas |
| VAST Native Architecture | [`docs/VAST_NATIVE_ARCHITECTURE.md`](../VAST_NATIVE_ARCHITECTURE.md) | System design, data models, event flows |
| Deployment Guide | [`docs/deployment-guide.md`](../deployment-guide.md) | Setup, deployment modes, CLI reference |
| Runbook | [`docs/runbook.md`](../runbook.md) | SLOs, escalation matrix, operational procedures |
| Release Process | [`RELEASE.md`](../../RELEASE.md) | Versioning, hotfix procedure, release steps |
| Security Policy | [`SECURITY.md`](../../SECURITY.md) | Vulnerability disclosure, credential management |
| Disaster Recovery | [`docs/disaster-recovery.md`](../disaster-recovery.md) | RTO/RPO targets, recovery procedures |
| Troubleshooting | [`docs/troubleshooting.md`](../troubleshooting.md) | Decision trees for common failures |
| Monitoring | [`docs/monitoring-setup.md`](../monitoring-setup.md) | Prometheus, alerting, Grafana setup |
| ADRs | [`docs/adr/`](../adr/README.md) | Architecture Decision Records |
| API Versioning | [`docs/api-versioning.md`](../api-versioning.md) | Compatibility guarantees, deprecation policy |

## Contribution Flow

1. Open or link a docs issue.
2. Update the wiki page and mirrored repo page in one PR.
3. Add a short docs impact note in the PR body.
4. Validate intra-wiki links before merge.
