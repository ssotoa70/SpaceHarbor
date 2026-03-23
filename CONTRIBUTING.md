# Contributing to SpaceHarbor

Thank you for your interest in contributing. This guide covers how to get started.

## Prerequisites

- Node.js 18+ (npm 9+)
- Python 3.11+
- Docker & Docker Compose
- Git

## Getting Started

```bash
git clone https://github.com/xebyte/SpaceHarbor.git
cd SpaceHarbor

# Control plane
cd services/control-plane && npm ci && npm run dev

# Web UI (separate terminal)
cd services/web-ui && npm ci && npm run dev

# Run tests
cd services/control-plane && npm test
cd services/web-ui && npx vitest run
```

## Development Guidelines

- **Commits:** Use conventional commits (`feat:`, `fix:`, `docs:`, `test:`)
- **Branches:** Feature branches, PRs required for main
- **TypeScript:** Run `tsc --noEmit` before committing
- **Tests:** All new features need tests
- **Style:** Prettier for TypeScript, Ruff for Python

## Architecture

- See `services/control-plane/ARCHITECTURE.md` for backend details
- See `services/web-ui/ARCHITECTURE.md` for frontend details
- See `docs/adr/` for architectural decision records

## Code of Conduct

Be respectful, constructive, and inclusive. We follow the [Contributor Covenant](https://www.contributor-covenant.org/).
