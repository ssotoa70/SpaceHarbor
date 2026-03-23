# SpaceHarbor GitHub Wiki

Complete documentation for SpaceHarbor—a VAST-native Media Asset Management platform for post-production and VFX studios.

## Wiki Structure

This wiki contains 12 comprehensive pages organized by audience and use case:

### Getting Started
- **[Home](Home.md)** — Welcome, quick links, system overview
- **[Quick Start](Quick-Start.md)** — 5-minute setup for development
- **[Installation Guide](Installation-Guide.md)** — Detailed setup for production

### Core Operations
- **[Deployment Guide](Deployment-Guide.md)** — Production rollout, load balancing, scaling
- **[Configuration Guide](Configuration-Guide.md)** — Environment variables, VAST integration settings
- **[Identity and Access](Identity-and-Access.md)** — Authentication, RBAC, SSO, SCIM

### Architecture & Design
- **[Architecture Overview](Architecture.md)** — System design, components, data model, event flow
- **[Pipeline and Functions](Pipeline-and-Functions.md)** — Media processing, DataEngine functions
- **[API Reference](API-Reference.md)** — REST endpoints, examples, error handling

### Operations & Support
- **[Monitoring and Observability](Monitoring.md)** — Health checks, metrics, alerting, dashboards
- **[Troubleshooting](Troubleshooting.md)** — Common issues and solutions
- **[License and Notices](License-and-Notices.md)** — Licensing and third-party attributions

## Content Organization

Pages are written for **external users, operators, and contributors** — not internal team members.

### For First-Time Users
1. Read [Home](Home.md) for context
2. Follow [Quick Start](Quick-Start.md) to run locally
3. Review [Architecture Overview](Architecture.md) to understand design
4. Explore [API Reference](API-Reference.md) for endpoints

### For Operators & SREs
1. Follow [Installation Guide](Installation-Guide.md) for setup
2. Use [Deployment Guide](Deployment-Guide.md) for production rollout
3. Configure [Identity and Access](Identity-and-Access.md) for multi-user
4. Set up [Monitoring and Observability](Monitoring.md) for alerts
5. Bookmark [Troubleshooting](Troubleshooting.md) for issue resolution

### For Developers & Integrators
1. Review [Architecture Overview](Architecture.md)
2. Study [API Reference](API-Reference.md)
3. Explore [Pipeline and Functions](Pipeline-and-Functions.md) for custom processing
4. Check source code for implementation details

### For Architects & Decision-Makers
1. Review [Home](Home.md) for feature overview
2. Study [Architecture Overview](Architecture.md) for design decisions
3. Review [Deployment Guide](Deployment-Guide.md) for ops requirements
4. Check [Configuration Guide](Configuration-Guide.md) for customization options

## Key Features Documented

### Asset Lifecycle
- Ingest from S3, NFS, or direct upload
- Automatic metadata extraction via VAST DataEngine
- Flexible approval workflows
- Audit trail and compliance logging

### VAST Integration
- Element handles (immutable file identifiers)
- Trino database (VAST Database) for persistence
- Kafka Event Broker for event-driven workflows
- DataEngine for serverless media processing

### Security & Access
- Local authentication (dev mode)
- JWT tokens and API keys
- OIDC/SSO integration (Okta, Azure AD, etc.)
- SCIM user provisioning
- Role-based access control (RBAC)

### Operations
- Horizontal scaling with stateless design
- Real-time monitoring and alerting
- Disaster recovery procedures
- Health checks and uptime monitoring

## Code Examples

**Quick ingest:**
```bash
curl -X POST http://localhost:3000/api/v1/assets/ingest \
  -H "Content-Type: application/json" \
  -d '{"title": "My Asset", "sourceUri": "s3://bucket/asset.mov"}'
```

**Check API health:**
```bash
curl http://localhost:3000/health
```

**List assets:**
```bash
curl http://localhost:3000/api/v1/assets
```

**View metrics:**
```bash
curl http://localhost:3000/api/v1/metrics | jq .
```

See [API Reference](API-Reference.md) for comprehensive endpoint documentation.

## Deployment Architectures

### Development (Local)
- Single instance
- In-memory persistence
- No VAST cluster required
- 5-minute setup

### Production (VAST-Integrated)
- Multi-instance with load balancer
- VAST Database (Trino) for persistence
- VAST Event Broker (Kafka) for events
- VAST DataEngine for processing

### Kubernetes (Enterprise)
- Horizontal pod autoscaling
- Managed DNS and TLS
- Centralized logging and monitoring
- High availability with replicas

See [Deployment Guide](Deployment-Guide.md) for detailed setup for each architecture.

## Running Examples

### Start Local Development

```bash
# 1. Clone and install
git clone https://github.com/your-org/spaceharbor.git
cd spaceharbor
npm ci

# 2. Start control-plane (port 3000)
cd services/control-plane
npm ci
npm run dev

# 3. Start web-ui (port 4173) in another terminal
cd services/web-ui
npm ci
npm run dev

# 4. Open browser
open http://localhost:4173
```

Default credentials: `dev@example.com` / `devpass123`

See [Quick Start](Quick-Start.md) for detailed walkthrough.

### Deploy to Production

```bash
# 1. Gather VAST credentials from cluster admin
# - Trino endpoint
# - S3 access key/secret
# - Event Broker URL and SASL credentials

# 2. Create .env with production values
cat > .env.production << EOF
NODE_ENV=production
VAST_TRINO_ENDPOINT=https://vastdb.example.com:8443
# ... all required variables
EOF

# 3. Build and deploy
docker compose build
docker compose -f docker-compose.prod.yml up -d

# 4. Verify
curl https://spaceharbor.example.com/health
```

See [Deployment Guide](Deployment-Guide.md) for comprehensive production checklist.

## Cross-References

Pages link extensively to related documentation:

- **[Home](Home.md)** — Links to all category pages
- **[Architecture Overview](Architecture.md)** — Links to API, Config, Deployment
- **[API Reference](API-Reference.md)** — Links to Architecture, Event Contracts
- **[Troubleshooting](Troubleshooting.md)** — Links to Configuration, Monitoring, Deployment

No circular dependencies; navigation is always forward to more detailed docs.

## External Resources

For VAST platform details, see:
- [VAST Data Platform Documentation](https://www.vastdata.com/docs)
- VAST Event Broker (Kafka) setup guides
- VAST DataEngine function development

## Conventions

### Code Blocks
- Bash examples show command + output
- JSON shown with proper formatting
- Configuration variables in `SCREAMING_SNAKE_CASE`
- Paths use forward slashes (works on all OS)

### Link Format
- Internal: `[Page Title](Page-Name.md)`
- External: `[Title](https://external.com)`
- API endpoints: `GET /api/v1/assets`

### Terminology
- **VAST** — VAST Data platform
- **Control-plane** — SpaceHarbor API server (Fastify/Node.js)
- **Web-UI** — React dashboard
- **DataEngine** — VAST serverless processing service
- **Element Handle** — Immutable file identifier (e.g., `elem_abc123xyz`)
- **Ingest** — Import asset into SpaceHarbor
- **Approval** — Review and sign-off workflow
- **DLQ** — Dead-Letter Queue (failed jobs)

## Maintenance

### Updating Documentation

1. Edit the corresponding `.md` file
2. Test links and examples
3. Commit with message: `docs: Update [section] for clarity`
4. Push to GitHub; wiki auto-syncs from `docs/wiki/`

### Keeping Content Current

- Review quarterly for version updates
- Update configuration examples when defaults change
- Add troubleshooting entries as issues are resolved
- Archive superseded information in `/archive`

### Feedback

If documentation is unclear or incomplete:
1. Open an issue describing the gap
2. Reference the specific page and section
3. Suggest improvements

---

**Latest Update:** March 2026
**Status:** Complete and production-ready
**Audience:** External users, operators, contributors

Start with [Home](Home.md) for a guided tour.
