# Getting Started

> For comprehensive setup including deployment modes, VAST credentials, CI/CD configuration, and troubleshooting, see [Deployment Guide](../deployment-guide.md).

## Quick Start (Local Mode)

1. Copy `.env.example` to `.env`
2. Set `SPACEHARBOR_PERSISTENCE_BACKEND=local` for development
3. Run `docker compose up --build`
4. Run `npm run test:all` to validate

## Deployment Modes

| Mode | Backend | Use Case |
|------|---------|----------|
| `local` | In-memory | Frontend development, UI testing, exploration |
| `cloud` | VAST SaaS | Staging or production against cloud VAST |
| `onprem` | Self-hosted VAST | Internal VAST cluster |

Run the interactive wizard:

```bash
python scripts/deploy.py --mode local
```

## Further Reading

- [Deployment Guide](../deployment-guide.md) -- full deployment reference with CLI flags, non-interactive mode, and troubleshooting
- [CONTRIBUTING.md](../../CONTRIBUTING.md) -- development setup, branch conventions, and PR workflow
- [Architecture](./Architecture.md) -- system design overview
