# OpenAssetIO Manager Service — Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Build a standalone Python FastAPI service that implements the OpenAssetIO Manager Plugin interface, enabling DCC apps (Maya, Nuke, Houdini) to resolve, browse, and register assets stored in VAST.

**Architecture:** New `services/openassetio-manager/` Python 3.12 FastAPI service. DCC apps call it via the OpenAssetIO host plugin SDK. The service resolves entity references to VAST NFS/S3 URIs by querying VastDB via Trino REST API. In dev mode, returns mock URIs. Existing control-plane `dcc.ts` stubs gain a `manager_uri` field pointing at this service.

**Tech Stack:** Python 3.12, FastAPI, uvicorn, openassetio (Python SDK), requests (Trino REST), pytest, httpx (test client)

**Design doc:** `docs/plans/2026-03-05-aswf-integrations-design.md`

---

### Task 1: Scaffold the service directory and dependencies

**Files:**
- Create: `services/openassetio-manager/pyproject.toml`
- Create: `services/openassetio-manager/src/__init__.py`
- Create: `services/openassetio-manager/src/main.py`
- Create: `services/openassetio-manager/tests/__init__.py`

**Step 1: Create directory structure**

```bash
mkdir -p services/openassetio-manager/src
mkdir -p services/openassetio-manager/tests
touch services/openassetio-manager/src/__init__.py
touch services/openassetio-manager/tests/__init__.py
```

**Step 2: Create `pyproject.toml`**

```toml
[build-system]
requires = ["hatchling"]
build-backend = "hatchling.build"

[project]
name = "openassetio-manager"
version = "0.1.0"
requires-python = ">=3.12"
dependencies = [
    "fastapi>=0.110.0",
    "uvicorn[standard]>=0.27.0",
    "openassetio>=1.0.0b2",
    "requests>=2.31.0",
    "python-multipart>=0.0.9",
]

[project.optional-dependencies]
dev = [
    "pytest>=8.0.0",
    "pytest-asyncio>=0.23.0",
    "httpx>=0.27.0",
]

[tool.pytest.ini_options]
asyncio_mode = "auto"
testpaths = ["tests"]
```

**Step 3: Create `src/main.py` skeleton**

```python
from fastapi import FastAPI

app = FastAPI(title="AssetHarbor OpenAssetIO Manager", version="0.1.0")


@app.get("/health")
async def health() -> dict:
    return {"status": "ok", "service": "openassetio-manager"}
```

**Step 4: Install dependencies**

```bash
cd services/openassetio-manager
python -m venv .venv
source .venv/bin/activate
pip install -e ".[dev]"
```

**Step 5: Write health check test**

```python
# tests/test_health.py
from httpx import AsyncClient, ASGITransport
from src.main import app
import pytest


@pytest.mark.asyncio
async def test_health():
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
        response = await client.get("/health")
    assert response.status_code == 200
    assert response.json()["status"] == "ok"
```

**Step 6: Run tests**

```bash
cd services/openassetio-manager
pytest tests/test_health.py -v
```

Expected: PASS

**Step 7: Commit**

```bash
git add services/openassetio-manager/
git commit -m "feat: scaffold openassetio-manager service with health endpoint"
```

---

### Task 2: Implement `resolver.py` — VastDB URI resolution

**Files:**
- Create: `services/openassetio-manager/src/resolver.py`
- Create: `services/openassetio-manager/tests/test_resolver.py`

**Step 1: Write failing tests**

```python
# tests/test_resolver.py
import pytest
from unittest.mock import patch, MagicMock
from src.resolver import VastResolver, AssetNotFoundError


def test_resolve_returns_vast_uri_for_known_asset():
    resolver = VastResolver(trino_host="localhost", trino_port=8080, dev_mode=True)
    uri = resolver.resolve("asset:abc123")
    assert uri.startswith("vast://") or uri.startswith("nfs://") or uri.startswith("mock://")


def test_resolve_raises_for_unknown_asset():
    resolver = VastResolver(trino_host="localhost", trino_port=8080, dev_mode=True)
    with pytest.raises(AssetNotFoundError):
        resolver.resolve("asset:NONEXISTENT_XYZ_999")


def test_resolve_dev_mode_does_not_call_trino():
    resolver = VastResolver(trino_host="localhost", trino_port=8080, dev_mode=True)
    with patch("src.resolver.requests.get") as mock_get:
        resolver.resolve("asset:abc123")
        mock_get.assert_not_called()
```

**Step 2: Run — verify FAIL**

```bash
pytest tests/test_resolver.py -v
```

Expected: FAIL — `ModuleNotFoundError: No module named 'src.resolver'`

**Step 3: Implement `src/resolver.py`**

```python
import os
import requests
from dataclasses import dataclass


class AssetNotFoundError(Exception):
    pass


@dataclass
class VastResolver:
    trino_host: str
    trino_port: int
    dev_mode: bool = False
    _dev_store: dict = None

    def __post_init__(self):
        self._dev_store = {
            "asset:abc123": "mock://vast/ingest/abc123/source.exr",
            "asset:def456": "mock://vast/ingest/def456/source.mov",
        }

    def resolve(self, entity_ref: str) -> str:
        """Resolve an entity reference to a VAST URI."""
        if self.dev_mode:
            uri = self._dev_store.get(entity_ref)
            if uri is None:
                raise AssetNotFoundError(f"Asset not found: {entity_ref}")
            return uri

        asset_id = entity_ref.removeprefix("asset:")
        return self._query_vastdb(asset_id)

    def _query_vastdb(self, asset_id: str) -> str:
        """Query VastDB via Trino REST API for asset source URI."""
        url = f"http://{self.trino_host}:{self.trino_port}/v1/statement"
        query = f"SELECT source_uri FROM assetharbor.assets WHERE id = '{asset_id}' LIMIT 1"
        headers = {"X-Trino-User": "assetharbor", "Content-Type": "text/plain"}
        response = requests.post(url, data=query, headers=headers, timeout=10)
        response.raise_for_status()
        data = response.json()
        rows = data.get("data", [])
        if not rows:
            raise AssetNotFoundError(f"Asset not found in VastDB: {asset_id}")
        return rows[0][0]

    def list_assets(self, shot_id: str | None = None, project_id: str | None = None) -> list[dict]:
        """List assets optionally filtered by shot or project."""
        if self.dev_mode:
            return [
                {"id": "abc123", "name": "hero_plate_v001.exr", "shot_id": shot_id or "sh010"},
                {"id": "def456", "name": "hero_plate_v002.mov", "shot_id": shot_id or "sh010"},
            ]
        # Production: query VastDB
        filters = []
        if shot_id:
            filters.append(f"shot_id = '{shot_id}'")
        if project_id:
            filters.append(f"project_id = '{project_id}'")
        where = f"WHERE {' AND '.join(filters)}" if filters else ""
        query = f"SELECT id, name, shot_id, source_uri FROM assetharbor.assets {where} LIMIT 100"
        url = f"http://{self.trino_host}:{self.trino_port}/v1/statement"
        headers = {"X-Trino-User": "assetharbor", "Content-Type": "text/plain"}
        response = requests.post(url, data=query, headers=headers, timeout=10)
        response.raise_for_status()
        data = response.json()
        return [
            {"id": r[0], "name": r[1], "shot_id": r[2], "source_uri": r[3]}
            for r in data.get("data", [])
        ]
```

**Step 4: Run tests**

```bash
pytest tests/test_resolver.py -v
```

Expected: PASS (3/3)

**Step 5: Commit**

```bash
git add services/openassetio-manager/src/resolver.py services/openassetio-manager/tests/test_resolver.py
git commit -m "feat: add VastResolver with dev mode and Trino REST support"
```

---

### Task 3: Implement `POST /resolve` endpoint

**Files:**
- Create: `services/openassetio-manager/src/routes/manager.py`
- Modify: `services/openassetio-manager/src/main.py`
- Create: `services/openassetio-manager/tests/test_resolve_endpoint.py`

**Step 1: Write failing tests**

```python
# tests/test_resolve_endpoint.py
import pytest
from httpx import AsyncClient, ASGITransport
from src.main import app


@pytest.mark.asyncio
async def test_resolve_known_asset():
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
        response = await client.post("/resolve", json={"entity_ref": "asset:abc123"})
    assert response.status_code == 200
    body = response.json()
    assert "uri" in body
    assert body["uri"].startswith("mock://") or body["uri"].startswith("vast://")


@pytest.mark.asyncio
async def test_resolve_unknown_asset_returns_404():
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
        response = await client.post("/resolve", json={"entity_ref": "asset:NONEXISTENT"})
    assert response.status_code == 404
    assert "not found" in response.json()["detail"].lower()


@pytest.mark.asyncio
async def test_resolve_missing_body_returns_422():
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
        response = await client.post("/resolve", json={})
    assert response.status_code == 422
```

**Step 2: Run — verify FAIL**

```bash
pytest tests/test_resolve_endpoint.py -v
```

Expected: FAIL — 404 on `/resolve` (route not registered)

**Step 3: Create `src/routes/__init__.py` and `src/routes/manager.py`**

```bash
mkdir -p services/openassetio-manager/src/routes
touch services/openassetio-manager/src/routes/__init__.py
```

```python
# src/routes/manager.py
import os
from fastapi import APIRouter, HTTPException
from pydantic import BaseModel
from src.resolver import VastResolver, AssetNotFoundError

router = APIRouter()

_resolver = VastResolver(
    trino_host=os.getenv("TRINO_HOST", "localhost"),
    trino_port=int(os.getenv("TRINO_PORT", "8080")),
    dev_mode=os.getenv("DEV_MODE", "true").lower() == "true",
)


class ResolveRequest(BaseModel):
    entity_ref: str


class ResolveResponse(BaseModel):
    entity_ref: str
    uri: str


@router.post("/resolve", response_model=ResolveResponse)
async def resolve(body: ResolveRequest) -> ResolveResponse:
    try:
        uri = _resolver.resolve(body.entity_ref)
        return ResolveResponse(entity_ref=body.entity_ref, uri=uri)
    except AssetNotFoundError as e:
        raise HTTPException(status_code=404, detail=str(e))
```

**Step 4: Register router in `src/main.py`**

```python
from fastapi import FastAPI
from src.routes.manager import router as manager_router

app = FastAPI(title="AssetHarbor OpenAssetIO Manager", version="0.1.0")
app.include_router(manager_router)


@app.get("/health")
async def health() -> dict:
    return {"status": "ok", "service": "openassetio-manager"}
```

**Step 5: Run tests**

```bash
pytest tests/test_resolve_endpoint.py tests/test_health.py -v
```

Expected: PASS (5/5)

**Step 6: Commit**

```bash
git add services/openassetio-manager/src/routes/ services/openassetio-manager/src/main.py services/openassetio-manager/tests/test_resolve_endpoint.py
git commit -m "feat: add POST /resolve OpenAssetIO endpoint"
```

---

### Task 4: Implement `POST /register` and `GET /browse` endpoints

**Files:**
- Modify: `services/openassetio-manager/src/routes/manager.py`
- Create: `services/openassetio-manager/tests/test_register_browse.py`

**Step 1: Write failing tests**

```python
# tests/test_register_browse.py
import pytest
from httpx import AsyncClient, ASGITransport
from src.main import app


@pytest.mark.asyncio
async def test_register_asset_returns_entity_ref():
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
        response = await client.post("/register", json={
            "name": "hero_plate_v003.exr",
            "shot_id": "sh010",
            "source_uri": "mock://vast/ingest/ghi789/hero_plate_v003.exr",
            "version_label": "v003",
        })
    assert response.status_code == 201
    body = response.json()
    assert "entity_ref" in body
    assert body["entity_ref"].startswith("asset:")


@pytest.mark.asyncio
async def test_browse_returns_asset_list():
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
        response = await client.get("/browse?shot_id=sh010")
    assert response.status_code == 200
    body = response.json()
    assert "assets" in body
    assert isinstance(body["assets"], list)


@pytest.mark.asyncio
async def test_browse_without_filters_returns_assets():
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
        response = await client.get("/browse")
    assert response.status_code == 200
    assert "assets" in response.json()
```

**Step 2: Run — verify FAIL**

```bash
pytest tests/test_register_browse.py -v
```

Expected: FAIL — 404 on `/register` and `/browse`

**Step 3: Add routes to `src/routes/manager.py`**

```python
import uuid
from fastapi import APIRouter, HTTPException, Query
from pydantic import BaseModel
from src.resolver import VastResolver, AssetNotFoundError
import os

router = APIRouter()

_resolver = VastResolver(
    trino_host=os.getenv("TRINO_HOST", "localhost"),
    trino_port=int(os.getenv("TRINO_PORT", "8080")),
    dev_mode=os.getenv("DEV_MODE", "true").lower() == "true",
)

# --- /resolve ---

class ResolveRequest(BaseModel):
    entity_ref: str

class ResolveResponse(BaseModel):
    entity_ref: str
    uri: str

@router.post("/resolve", response_model=ResolveResponse)
async def resolve(body: ResolveRequest) -> ResolveResponse:
    try:
        uri = _resolver.resolve(body.entity_ref)
        return ResolveResponse(entity_ref=body.entity_ref, uri=uri)
    except AssetNotFoundError as e:
        raise HTTPException(status_code=404, detail=str(e))

# --- /register ---

class RegisterRequest(BaseModel):
    name: str
    shot_id: str
    source_uri: str
    version_label: str

class RegisterResponse(BaseModel):
    entity_ref: str
    asset_id: str

@router.post("/register", response_model=RegisterResponse, status_code=201)
async def register(body: RegisterRequest) -> RegisterResponse:
    # Dev mode: generate a local ID. Prod: POST to control-plane /api/v1/ingest.
    asset_id = str(uuid.uuid4())
    if not os.getenv("DEV_MODE", "true").lower() == "true":
        import requests as req
        cp_url = os.getenv("CONTROL_PLANE_URL", "http://control-plane:3000")
        resp = req.post(f"{cp_url}/api/v1/ingest", json={
            "asset_id": asset_id,
            "name": body.name,
            "shot_id": body.shot_id,
            "source_uri": body.source_uri,
            "version_label": body.version_label,
        }, timeout=10)
        resp.raise_for_status()
    return RegisterResponse(entity_ref=f"asset:{asset_id}", asset_id=asset_id)

# --- /browse ---

class BrowseResponse(BaseModel):
    assets: list[dict]

@router.get("/browse", response_model=BrowseResponse)
async def browse(
    shot_id: str | None = Query(default=None),
    project_id: str | None = Query(default=None),
) -> BrowseResponse:
    assets = _resolver.list_assets(shot_id=shot_id, project_id=project_id)
    return BrowseResponse(assets=assets)
```

**Step 4: Run all tests**

```bash
pytest tests/ -v
```

Expected: PASS (all tests)

**Step 5: Commit**

```bash
git add services/openassetio-manager/src/routes/manager.py services/openassetio-manager/tests/test_register_browse.py
git commit -m "feat: add POST /register and GET /browse OpenAssetIO endpoints"
```

---

### Task 5: Add `manager_uri` to control-plane DCC stubs

**Files:**
- Modify: `services/control-plane/src/routes/dcc.ts:46-53` (mayaExportResponseSchema)
- Modify: `services/control-plane/test/dcc.test.ts`

**Step 1: Read current response schema in `dcc.ts`**

Open `services/control-plane/src/routes/dcc.ts`. The `mayaExportResponseSchema` at line ~46 currently returns `{ job_id, status }`.

**Step 2: Write failing test**

In `services/control-plane/test/dcc.test.ts`, add:

```typescript
it("maya export response includes manager_uri", async () => {
  const res = await app.inject({
    method: "POST",
    url: "/api/v1/dcc/maya/export-asset",
    headers: { "x-api-key": "test-key" },
    payload: {
      asset_id: "abc123",
      shot_id: "sh010",
      version_label: "v001",
      export_format: "exr",
    },
  });
  expect(res.statusCode).toBe(200);
  const body = JSON.parse(res.body);
  expect(body).toHaveProperty("manager_uri");
  expect(body.manager_uri).toContain("/resolve");
});
```

**Step 3: Run — verify FAIL**

```bash
cd services/control-plane
node --import tsx --test test/dcc.test.ts 2>&1 | tail -20
```

Expected: FAIL — `manager_uri` not in response

**Step 4: Update `dcc.ts` response schema and handler**

In `mayaExportResponseSchema`, add `manager_uri`:

```typescript
const mayaExportResponseSchema = {
  type: "object",
  required: ["job_id", "status", "manager_uri"],
  properties: {
    job_id: { type: "string" },
    status: { type: "string", enum: ["queued"] },
    manager_uri: { type: "string" },
  },
} as const;
```

In the handler, construct the manager URI:

```typescript
const managerBase = process.env.OPENASSETIO_MANAGER_URL ?? "http://openassetio-manager:8001";
return reply.status(200).send({
  job_id: `dcc-job-${randomUUID()}`,
  status: "queued" as const,
  manager_uri: `${managerBase}/resolve`,
});
```

**Step 5: Run all control-plane tests**

```bash
node --import tsx --test test/*.test.ts 2>&1 | tail -10
```

Expected: all PASS (≥139)

**Step 6: Commit**

```bash
git add services/control-plane/src/routes/dcc.ts services/control-plane/test/dcc.test.ts
git commit -m "feat: add manager_uri to DCC stub responses pointing at openassetio-manager"
```

---

### Task 6: Dockerfile and docker-compose integration

**Files:**
- Create: `services/openassetio-manager/Dockerfile`
- Modify: `docker-compose.yml`

**Step 1: Write `Dockerfile`**

```dockerfile
FROM python:3.12-slim

WORKDIR /app

COPY pyproject.toml .
RUN pip install --no-cache-dir -e .

COPY src/ src/

ENV DEV_MODE=true
ENV TRINO_HOST=vastdb
ENV TRINO_PORT=8080

EXPOSE 8001

CMD ["uvicorn", "src.main:app", "--host", "0.0.0.0", "--port", "8001"]
```

**Step 2: Add service to `docker-compose.yml`**

```yaml
  openassetio-manager:
    build:
      context: services/openassetio-manager
      dockerfile: Dockerfile
    ports:
      - "8001:8001"
    environment:
      - DEV_MODE=true
      - TRINO_HOST=vastdb
      - TRINO_PORT=8080
      - CONTROL_PLANE_URL=http://control-plane:3000
    depends_on:
      control-plane:
        condition: service_healthy
    healthcheck:
      test: ["CMD", "curl", "-f", "http://localhost:8001/health"]
      interval: 10s
      timeout: 5s
      retries: 3
```

**Step 3: Verify build**

```bash
docker build -t openassetio-manager services/openassetio-manager/
```

Expected: BUILD successful

**Step 4: Commit**

```bash
git add services/openassetio-manager/Dockerfile docker-compose.yml
git commit -m "feat: add openassetio-manager Dockerfile and docker-compose service"
```
