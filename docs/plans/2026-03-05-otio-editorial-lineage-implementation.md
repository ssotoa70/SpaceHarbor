# OTIO Editorial Lineage — Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Ingest editorial timelines (EDL/XML/OTIO) and auto-conform the MAM by flagging asset versions as "in-cut" or "out-of-cut" in VastDB, triggered by VAST element events.

**Architecture:** Control-plane stub route (`POST /api/v1/timeline/ingest`) accepts file uploads and calls the `openassetio-manager` service's `/timeline/parse` endpoint (Python OTIO library). Parsed shot list is correlated against VastDB assets. A VAST DataEngine conform function runs when an OTIO file lands in a VAST view, updating `in_cut` metadata. Two new Kafka events: `timeline.ingested`, `timeline.conformed`.

**Tech Stack:** Python 3.12 + opentimelineio (in openassetio-manager), TypeScript/Fastify (control-plane stub), VAST DataEngine (conform function), Confluent Kafka

**Pre-requisite:** `services/openassetio-manager/` scaffolded (Task 1 of openassetio-manager plan complete).

**Design doc:** `docs/plans/2026-03-05-aswf-integrations-design.md`

---

### Task 1: Add OTIO dependency to openassetio-manager

**Files:**
- Modify: `services/openassetio-manager/pyproject.toml`

**Step 1: Add `opentimelineio` to dependencies**

In `pyproject.toml`, add to `dependencies`:

```toml
"opentimelineio>=0.16.0",
```

**Step 2: Reinstall**

```bash
cd services/openassetio-manager
source .venv/bin/activate
pip install -e ".[dev]"
```

**Step 3: Verify import**

```bash
python -c "import opentimelineio; print(opentimelineio.__version__)"
```

Expected: prints version (e.g. `0.16.0`)

**Step 4: Commit**

```bash
git add services/openassetio-manager/pyproject.toml
git commit -m "feat: add opentimelineio dependency to openassetio-manager"
```

---

### Task 2: Implement `timeline.py` — OTIO parser

**Files:**
- Create: `services/openassetio-manager/src/timeline.py`
- Create: `services/openassetio-manager/tests/test_timeline.py`
- Create: `services/openassetio-manager/tests/fixtures/sample.otio`

**Step 1: Create a minimal sample OTIO fixture**

```bash
python - <<'EOF'
import opentimelineio as otio
import json

timeline = otio.schema.Timeline(name="SampleCut")
track = otio.schema.Track(name="Video", kind=otio.schema.TrackKind.Video)
timeline.tracks.append(track)

clip1 = otio.schema.Clip(
    name="sh010_hero_plate_v001",
    source_range=otio.opentime.TimeRange(
        start_time=otio.opentime.RationalTime(0, 24),
        duration=otio.opentime.RationalTime(48, 24),
    ),
)
clip1.metadata["asset_id"] = "abc123"
clip1.metadata["version_label"] = "v001"

clip2 = otio.schema.Clip(
    name="sh020_hero_plate_v002",
    source_range=otio.opentime.TimeRange(
        start_time=otio.opentime.RationalTime(0, 24),
        duration=otio.opentime.RationalTime(72, 24),
    ),
)
clip2.metadata["asset_id"] = "def456"
clip2.metadata["version_label"] = "v002"

track.extend([clip1, clip2])

with open("tests/fixtures/sample.otio", "w") as f:
    f.write(otio.adapters.write_to_string(timeline, adapter_name="otio_json"))

print("Created tests/fixtures/sample.otio")
EOF
```

**Step 2: Write failing tests**

```python
# tests/test_timeline.py
import pytest
from pathlib import Path
from src.timeline import OtioParser, TimelineParseError

FIXTURE = Path(__file__).parent / "fixtures" / "sample.otio"


def test_parse_otio_file_returns_shot_list():
    parser = OtioParser()
    result = parser.parse_file(FIXTURE)
    assert "shots" in result
    assert len(result["shots"]) == 2


def test_parse_otio_shot_has_required_fields():
    parser = OtioParser()
    result = parser.parse_file(FIXTURE)
    shot = result["shots"][0]
    assert "name" in shot
    assert "duration_frames" in shot
    assert "in_cut" in shot
    assert shot["in_cut"] is True


def test_parse_nonexistent_file_raises():
    parser = OtioParser()
    with pytest.raises(TimelineParseError):
        parser.parse_file(Path("/nonexistent/file.otio"))


def test_parse_otio_string_content():
    parser = OtioParser()
    content = FIXTURE.read_text()
    result = parser.parse_string(content, format="otio_json")
    assert len(result["shots"]) == 2
```

**Step 3: Run — verify FAIL**

```bash
pytest tests/test_timeline.py -v
```

Expected: FAIL — `ModuleNotFoundError: No module named 'src.timeline'`

**Step 4: Implement `src/timeline.py`**

```python
import opentimelineio as otio
from dataclasses import dataclass, field
from pathlib import Path


class TimelineParseError(Exception):
    pass


@dataclass
class OtioParser:
    def parse_file(self, path: Path) -> dict:
        """Parse an OTIO/EDL/XML timeline file. Returns shot list."""
        if not path.exists():
            raise TimelineParseError(f"File not found: {path}")
        try:
            timeline = otio.adapters.read_from_file(str(path))
            return self._extract_shots(timeline)
        except Exception as e:
            raise TimelineParseError(f"Failed to parse {path}: {e}") from e

    def parse_string(self, content: str, format: str = "otio_json") -> dict:
        """Parse OTIO content from a string."""
        try:
            timeline = otio.adapters.read_from_string(content, adapter_name=format)
            return self._extract_shots(timeline)
        except Exception as e:
            raise TimelineParseError(f"Failed to parse content: {e}") from e

    def _extract_shots(self, timeline: otio.schema.Timeline) -> dict:
        shots = []
        for track in timeline.tracks:
            if track.kind != otio.schema.TrackKind.Video:
                continue
            for clip in track:
                if not isinstance(clip, otio.schema.Clip):
                    continue
                duration = clip.source_range.duration if clip.source_range else None
                shots.append({
                    "name": clip.name,
                    "asset_id": clip.metadata.get("asset_id"),
                    "version_label": clip.metadata.get("version_label"),
                    "duration_frames": int(duration.to_frames()) if duration else None,
                    "in_cut": True,
                })
        return {"timeline_name": timeline.name, "shots": shots}
```

**Step 5: Run tests**

```bash
pytest tests/test_timeline.py -v
```

Expected: PASS (4/4)

**Step 6: Commit**

```bash
git add services/openassetio-manager/src/timeline.py services/openassetio-manager/tests/test_timeline.py services/openassetio-manager/tests/fixtures/sample.otio
git commit -m "feat: add OtioParser for EDL/XML/OTIO timeline parsing"
```

---

### Task 3: Add `POST /timeline/parse` endpoint to openassetio-manager

**Files:**
- Create: `services/openassetio-manager/src/routes/timeline.py`
- Modify: `services/openassetio-manager/src/main.py`
- Create: `services/openassetio-manager/tests/test_timeline_endpoint.py`

**Step 1: Write failing tests**

```python
# tests/test_timeline_endpoint.py
import pytest
from httpx import AsyncClient, ASGITransport
from src.main import app
from pathlib import Path

FIXTURE = Path(__file__).parent / "fixtures" / "sample.otio"


@pytest.mark.asyncio
async def test_parse_otio_file_via_endpoint():
    content = FIXTURE.read_bytes()
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
        response = await client.post(
            "/timeline/parse",
            files={"file": ("sample.otio", content, "application/json")},
        )
    assert response.status_code == 200
    body = response.json()
    assert "shots" in body
    assert len(body["shots"]) >= 1


@pytest.mark.asyncio
async def test_parse_invalid_file_returns_422():
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
        response = await client.post(
            "/timeline/parse",
            files={"file": ("bad.otio", b"not valid otio content", "application/json")},
        )
    assert response.status_code == 422
```

**Step 2: Run — verify FAIL**

```bash
pytest tests/test_timeline_endpoint.py -v
```

Expected: FAIL — 404 on `/timeline/parse`

**Step 3: Create `src/routes/timeline.py`**

```python
from fastapi import APIRouter, UploadFile, HTTPException
from src.timeline import OtioParser, TimelineParseError

router = APIRouter(prefix="/timeline")
_parser = OtioParser()


@router.post("/parse")
async def parse_timeline(file: UploadFile) -> dict:
    content = await file.read()
    try:
        # Detect format from filename extension
        fmt = "otio_json"
        if file.filename and file.filename.endswith(".edl"):
            fmt = "cmx_3600"
        elif file.filename and file.filename.endswith(".xml"):
            fmt = "fcp_xml"
        return _parser.parse_string(content.decode("utf-8"), format=fmt)
    except TimelineParseError as e:
        raise HTTPException(status_code=422, detail=str(e))
```

**Step 4: Register in `src/main.py`**

```python
from fastapi import FastAPI
from src.routes.manager import router as manager_router
from src.routes.timeline import router as timeline_router

app = FastAPI(title="AssetHarbor OpenAssetIO Manager", version="0.1.0")
app.include_router(manager_router)
app.include_router(timeline_router)

@app.get("/health")
async def health() -> dict:
    return {"status": "ok", "service": "openassetio-manager"}
```

**Step 5: Run all tests**

```bash
pytest tests/ -v
```

Expected: PASS (all)

**Step 6: Commit**

```bash
git add services/openassetio-manager/src/routes/timeline.py services/openassetio-manager/src/main.py services/openassetio-manager/tests/test_timeline_endpoint.py
git commit -m "feat: add POST /timeline/parse endpoint for OTIO ingestion"
```

---

### Task 4: Add timeline events to control-plane event types

**Files:**
- Modify: `services/control-plane/src/events/types.ts`
- Modify: `services/control-plane/test/event-types.test.ts` (or create if missing)

**Step 1: Add new event types to `src/events/types.ts`**

Open the file and append:

```typescript
// Timeline events (OTIO conform)
export interface TimelineIngestedEvent {
  type: "timeline.ingested";
  timeline_id: string;
  vast_path: string;
  shot_count: number;
  timestamp: string;
}

export interface TimelineConformedEvent {
  type: "timeline.conformed";
  timeline_id: string;
  in_cut_count: number;
  out_of_cut_count: number;
  timestamp: string;
}

export type AssetHarborEvent =
  | VastDataEngineCompletionEvent
  | TimelineIngestedEvent
  | TimelineConformedEvent;
```

**Step 2: Write test for type guards**

```typescript
// test/timeline-events.test.ts
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import type { TimelineIngestedEvent, TimelineConformedEvent } from "../src/events/types.js";

describe("timeline event types", () => {
  it("TimelineIngestedEvent has required fields", () => {
    const ev: TimelineIngestedEvent = {
      type: "timeline.ingested",
      timeline_id: "tl-001",
      vast_path: "/vast/timelines/tl-001.otio",
      shot_count: 12,
      timestamp: new Date().toISOString(),
    };
    assert.equal(ev.type, "timeline.ingested");
    assert.equal(ev.shot_count, 12);
  });

  it("TimelineConformedEvent has required fields", () => {
    const ev: TimelineConformedEvent = {
      type: "timeline.conformed",
      timeline_id: "tl-001",
      in_cut_count: 10,
      out_of_cut_count: 2,
      timestamp: new Date().toISOString(),
    };
    assert.equal(ev.in_cut_count, 10);
    assert.equal(ev.out_of_cut_count, 2);
  });
});
```

**Step 3: Run tests**

```bash
cd services/control-plane
node --import tsx --test test/timeline-events.test.ts
```

Expected: PASS

**Step 4: TypeScript check**

```bash
./node_modules/.bin/tsc --noEmit
```

Expected: 0 errors

**Step 5: Commit**

```bash
git add services/control-plane/src/events/types.ts services/control-plane/test/timeline-events.test.ts
git commit -m "feat: add timeline.ingested and timeline.conformed event types"
```

---

### Task 5: Add `POST /api/v1/timeline/ingest` stub route to control-plane

**Files:**
- Create: `services/control-plane/src/routes/timeline.ts`
- Modify: `services/control-plane/src/app.ts`
- Create: `services/control-plane/test/timeline.test.ts`

**Step 1: Write failing tests**

```typescript
// test/timeline.test.ts
import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import { buildApp } from "../src/app.js";
import type { FastifyInstance } from "fastify";

let app: FastifyInstance;

before(async () => {
  app = await buildApp({ logger: false });
  await app.ready();
});

after(async () => {
  await app.close();
});

describe("POST /api/v1/timeline/ingest", () => {
  it("returns 202 with timeline_id for valid upload", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/api/v1/timeline/ingest",
      headers: {
        "x-api-key": "test-key",
        "content-type": "application/json",
      },
      payload: {
        filename: "cut_v003.otio",
        content_base64: Buffer.from("{}").toString("base64"),
      },
    });
    assert.equal(res.statusCode, 202);
    const body = JSON.parse(res.body);
    assert.ok(body.timeline_id, "should have timeline_id");
    assert.equal(body.status, "processing");
  });

  it("returns 400 when filename missing", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/api/v1/timeline/ingest",
      headers: { "x-api-key": "test-key", "content-type": "application/json" },
      payload: {},
    });
    assert.equal(res.statusCode, 400);
  });
});

describe("GET /api/v1/timeline/:id", () => {
  it("returns 200 with conform status for known timeline", async () => {
    // First ingest
    const ingestRes = await app.inject({
      method: "POST",
      url: "/api/v1/timeline/ingest",
      headers: { "x-api-key": "test-key", "content-type": "application/json" },
      payload: { filename: "cut_v004.otio", content_base64: Buffer.from("{}").toString("base64") },
    });
    const { timeline_id } = JSON.parse(ingestRes.body);

    const res = await app.inject({
      method: "GET",
      url: `/api/v1/timeline/${timeline_id}`,
      headers: { "x-api-key": "test-key" },
    });
    assert.equal(res.statusCode, 200);
    const body = JSON.parse(res.body);
    assert.ok(body.timeline_id);
    assert.ok(["processing", "conformed", "failed"].includes(body.status));
  });
});
```

**Step 2: Run — verify FAIL**

```bash
node --import tsx --test test/timeline.test.ts 2>&1 | tail -20
```

Expected: FAIL — 404 routes not registered

**Step 3: Create `src/routes/timeline.ts`**

```typescript
import { randomUUID } from "node:crypto";
import type { FastifyInstance } from "fastify";
import { withPrefix } from "../http/routes.js";
import { sendError } from "../http/errors.js";
import { errorEnvelopeSchema } from "../http/schemas.js";

// In-memory store (Phase 4: migrate to VastDB)
const timelines = new Map<string, { id: string; filename: string; status: string; created_at: string }>();

const ingestBodySchema = {
  type: "object",
  required: ["filename", "content_base64"],
  properties: {
    filename: { type: "string", minLength: 1 },
    content_base64: { type: "string", minLength: 1 },
  },
} as const;

const ingestResponseSchema = {
  type: "object",
  required: ["timeline_id", "status"],
  properties: {
    timeline_id: { type: "string" },
    status: { type: "string", enum: ["processing"] },
  },
} as const;

const statusResponseSchema = {
  type: "object",
  required: ["timeline_id", "status"],
  properties: {
    timeline_id: { type: "string" },
    status: { type: "string", enum: ["processing", "conformed", "failed"] },
    in_cut_count: { type: "number" },
    out_of_cut_count: { type: "number" },
  },
} as const;

export async function registerTimelineRoutes(app: FastifyInstance, prefixes: string[]): Promise<void> {
  for (const prefix of prefixes) {
    app.post<{ Body: { filename: string; content_base64: string } }>(
      withPrefix(prefix, "/timeline/ingest"),
      {
        schema: {
          tags: ["timeline"],
          operationId: "v1TimelineIngest",
          summary: "Ingest editorial timeline (EDL/XML/OTIO)",
          security: [{ ApiKeyAuth: [] as string[] }],
          body: ingestBodySchema,
          response: {
            202: ingestResponseSchema,
            400: errorEnvelopeSchema,
            401: errorEnvelopeSchema,
          },
        },
      },
      async (request, reply) => {
        const { filename } = request.body;
        if (!filename) {
          return sendError(reply, 400, "filename is required");
        }
        const id = randomUUID();
        timelines.set(id, { id, filename, status: "processing", created_at: new Date().toISOString() });
        // TODO: forward decoded content to openassetio-manager /timeline/parse
        // TODO: store OTIO file in VAST view (triggers DataEngine conform function)
        return reply.status(202).send({ timeline_id: id, status: "processing" });
      },
    );

    app.get<{ Params: { id: string } }>(
      withPrefix(prefix, "/timeline/:id"),
      {
        schema: {
          tags: ["timeline"],
          operationId: "v1TimelineGet",
          summary: "Get timeline conform status",
          params: {
            type: "object",
            required: ["id"],
            properties: { id: { type: "string" } },
          },
          response: {
            200: statusResponseSchema,
            404: errorEnvelopeSchema,
          },
        },
      },
      async (request, reply) => {
        const tl = timelines.get(request.params.id);
        if (!tl) {
          return sendError(reply, 404, "Timeline not found");
        }
        return reply.status(200).send({ timeline_id: tl.id, status: tl.status });
      },
    );
  }
}
```

**Step 4: Register in `src/app.ts`**

Find where routes are registered (after `registerDccRoute`) and add:

```typescript
import { registerTimelineRoutes } from "./routes/timeline.js";
// ...inside buildApp or equivalent:
await registerTimelineRoutes(app, ["/api/v1"]);
```

**Step 5: Run all control-plane tests**

```bash
node --import tsx --test test/*.test.ts 2>&1 | tail -10
```

Expected: all PASS (≥141)

**Step 6: TypeScript check**

```bash
./node_modules/.bin/tsc --noEmit
```

Expected: 0 errors

**Step 7: Commit**

```bash
git add services/control-plane/src/routes/timeline.ts services/control-plane/src/app.ts services/control-plane/test/timeline.test.ts
git commit -m "feat: add timeline ingest and conform status routes (stub)"
```
