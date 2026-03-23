# Quick Start

Get SpaceHarbor running locally in 5 minutes for development, testing, or exploring the platform.

## Prerequisites

Ensure you have these installed:

- **Node.js** 18+ — Check: `node --version`
- **npm** 9+ — Check: `npm --version`
- **Docker** 20.10+ — Check: `docker version`
- **Docker Compose** v2+ — Check: `docker compose version`

## Step 1: Clone and Install

```bash
# Clone the repository
git clone https://github.com/your-org/spaceharbor.git
cd spaceharbor

# Install dependencies for control-plane and web-ui
npm ci
```

## Step 2: Start the Control-Plane API

In one terminal:

```bash
cd services/control-plane
npm ci
npm run dev
```

You'll see:

```
[12:34:56] listening on port 3000
[12:34:56] routes registered: assets, jobs, queue, approval, audit...
```

The API is now running at `http://localhost:3000`.

## Step 3: Start the Web UI

In another terminal:

```bash
cd services/web-ui
npm ci
npm run dev
```

You'll see:

```
VITE v4.x.x ready in 245 ms

➜  Local:   http://localhost:4173/
```

Open your browser to `http://localhost:4173`.

## Step 4: Login (Local Dev Mode)

SpaceHarbor runs in **local mode** by default (in-memory persistence, no VAST cluster required).

Default development credentials:

- **Email:** `dev@example.com`
- **Password:** `devpass123`

Or create a new account from the login screen.

## Step 5: Ingest Your First Asset

1. In the Web UI, click **Upload** or navigate to **Assets** → **Ingest**.
2. Provide:
   - **Title**: e.g., "My First Clip"
   - **Source URI**: e.g., `https://example.com/sample.mov` or a local file path
3. Click **Ingest**.

The system will:
- Create an asset record
- Simulate media processing (local mode)
- Display status updates in real-time
- Move the asset through the approval queue

## Step 6: View Assets and Approve

1. Navigate to **Assets** to see your ingested media.
2. Click an asset to see metadata: duration, resolution, codec, format.
3. Click **Approve** to move it through the workflow.

## API Quick Test

Check the API health:

```bash
curl http://localhost:3000/health
# Response: {"status": "ok", "service": "control-plane"}
```

Ingest an asset via API:

```bash
curl -X POST http://localhost:3000/api/v1/assets/ingest \
  -H "Content-Type: application/json" \
  -d '{
    "title": "API Test Asset",
    "sourceUri": "https://example.com/test.mov"
  }'
```

List assets:

```bash
curl http://localhost:3000/api/v1/assets
```

For full API documentation, see [API Reference](API-Reference.md).

## What's Running?

| Service | URL | Purpose |
|---------|-----|---------|
| Control-Plane API | `http://localhost:3000` | REST API for asset management |
| Web UI | `http://localhost:4173` | Browser-based dashboard |
| Swagger Docs | `http://localhost:3000/docs` | Interactive API documentation |

All data is stored **in-memory** and will be cleared when you restart the services.

## Next Steps

### For Development
- Explore the REST API at `http://localhost:3000/docs`
- Review the [API Reference](API-Reference.md) for endpoint details
- Check [Troubleshooting](Troubleshooting.md) if something breaks

### To Connect to VAST
- Follow [Deployment Guide](Deployment-Guide.md) for cloud/on-prem VAST setup
- Configure [Identity and Access](Identity-and-Access.md) for multi-user access
- Set up [Monitoring and Observability](Monitoring.md) for production

### To Extend the Platform
- Review [Architecture Overview](Architecture.md) to understand the design
- See [Pipeline and Functions](Pipeline-and-Functions.md) for custom processing
- Check the source code at `services/control-plane/src/routes/` for examples

## Troubleshooting

**Port already in use?**
```bash
# Check what's on port 3000
lsof -i :3000
# Or change the port
PORT=3001 npm run dev
```

**npm install fails?**
```bash
# Clear npm cache
npm cache clean --force
rm -rf node_modules
npm ci
```

**Web UI won't connect to API?**
Check that both services are running and the API is accessible:
```bash
curl http://localhost:3000/health
```

**Need to reset local data?**
Simply restart the services—all in-memory data is cleared:
```bash
npm run dev    # Restart control-plane
npm run dev    # Restart web-ui
```

## See Also

- [Installation Guide](Installation-Guide.md) — Detailed setup with VAST configuration
- [Architecture Overview](Architecture.md) — How SpaceHarbor works
- [Troubleshooting](Troubleshooting.md) — Solutions for common problems
