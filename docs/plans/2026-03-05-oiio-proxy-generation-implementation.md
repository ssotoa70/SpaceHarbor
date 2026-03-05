# OIIO Proxy Generation — Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Auto-generate JPEG thumbnails (256×256) and H.264 proxies (1920×1080) when EXR or DPX files land in a VAST view, using OpenImageIO running inside a VAST DataEngine containerized function.

**Architecture:** New `services/dataengine-functions/oiio-proxy-generator/` Python container. Triggered by VAST `ElementCreated` event on `*.exr` / `*.dpx` files. Runs OCIO color transform (see OCIO plan) before encoding. Writes outputs to VAST `thumbnails/` and `proxies/` views. Publishes `proxy.generated` CloudEvent to VAST Event Broker. Control-plane `VastEventSubscriber` receives event, updates `asset.thumbnail_uri` and `asset.proxy_uri` in VastDB. New `OiioProxyFunction` registered in control-plane data-engine registry.

**Tech Stack:** Python 3.12, OpenImageIO (oiiotool CLI + Python bindings), VAST DataEngine container, Confluent Kafka, TypeScript (control-plane function registration)

**Design doc:** `docs/plans/2026-03-05-aswf-integrations-design.md`

---

### Task 1: Scaffold `oiio-proxy-generator` DataEngine function

**Files:**
- Create: `services/dataengine-functions/oiio-proxy-generator/pyproject.toml`
- Create: `services/dataengine-functions/oiio-proxy-generator/src/__init__.py`
- Create: `services/dataengine-functions/oiio-proxy-generator/src/function.py`
- Create: `services/dataengine-functions/oiio-proxy-generator/tests/__init__.py`

**Step 1: Create directory structure**

```bash
mkdir -p services/dataengine-functions/oiio-proxy-generator/src
mkdir -p services/dataengine-functions/oiio-proxy-generator/tests
touch services/dataengine-functions/oiio-proxy-generator/src/__init__.py
touch services/dataengine-functions/oiio-proxy-generator/tests/__init__.py
```

**Step 2: Create `pyproject.toml`**

```toml
[build-system]
requires = ["hatchling"]
build-backend = "hatchling.build"

[project]
name = "oiio-proxy-generator"
version = "0.1.0"
requires-python = ">=3.12"
dependencies = [
    "OpenImageIO>=2.5.0",
    "requests>=2.31.0",
    "confluent-kafka>=2.4.0",
]

[project.optional-dependencies]
dev = [
    "pytest>=8.0.0",
    "pytest-asyncio>=0.23.0",
]

[tool.pytest.ini_options]
testpaths = ["tests"]
```

**Note:** `OpenImageIO` Python bindings may need to be installed via system package manager on some platforms. On Ubuntu: `apt-get install python3-openimageio`. The `oiiotool` CLI binary must be in `PATH`.

**Step 3: Create `src/function.py` skeleton**

```python
"""VAST DataEngine entrypoint for oiio-proxy-generator.

Called by VAST DataEngine when an ElementCreated event fires
on *.exr or *.dpx files in a monitored VAST view.

Environment variables:
  VAST_SOURCE_PATH  - NFS path to the new file (set by DataEngine)
  VAST_ASSET_ID     - AssetHarbor asset ID (set by DataEngine pipeline config)
  VAST_THUMB_PATH   - NFS path to write thumbnail output
  VAST_PROXY_PATH   - NFS path to write proxy output
  KAFKA_BROKER      - Kafka broker address (default: vastbroker:9092)
  KAFKA_TOPIC       - Kafka topic for completion events (default: assetharbor.proxy)
  DEV_MODE          - If "true", skip VAST I/O and use local test files
"""
import os
import sys
import logging

logging.basicConfig(level=logging.INFO, format="%(levelname)s %(message)s")
log = logging.getLogger("oiio-proxy-generator")


def main() -> int:
    source_path = os.environ.get("VAST_SOURCE_PATH", "")
    asset_id = os.environ.get("VAST_ASSET_ID", "")
    thumb_path = os.environ.get("VAST_THUMB_PATH", f"/tmp/{asset_id}_thumb.jpg")
    proxy_path = os.environ.get("VAST_PROXY_PATH", f"/tmp/{asset_id}_proxy.mp4")

    log.info(f"Processing asset {asset_id}: {source_path}")

    if not source_path or not asset_id:
        log.error("VAST_SOURCE_PATH and VAST_ASSET_ID must be set")
        return 1

    from src.oiio_processor import OiioProcessor
    from src.ocio_transform import OcioTransform

    processor = OiioProcessor()
    transform = OcioTransform(config_path=os.environ.get("OCIO_CONFIG_PATH"))

    # Step 1: Apply OCIO color transform
    transformed_path = transform.apply(source_path, target_colorspace="sRGB")

    # Step 2: Generate thumbnail and proxy
    processor.generate_thumbnail(transformed_path, thumb_path, width=256, height=256)
    processor.generate_proxy(transformed_path, proxy_path, width=1920, height=1080)

    # Step 3: Publish completion event
    from src.publisher import publish_proxy_generated
    publish_proxy_generated(
        asset_id=asset_id,
        thumbnail_uri=thumb_path,
        proxy_uri=proxy_path,
    )

    log.info(f"Done: thumb={thumb_path} proxy={proxy_path}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
```

**Step 4: Commit scaffold**

```bash
git add services/dataengine-functions/oiio-proxy-generator/
git commit -m "feat: scaffold oiio-proxy-generator DataEngine function"
```

---

### Task 2: Implement `oiio_processor.py` — thumbnail generation

**Files:**
- Create: `services/dataengine-functions/oiio-proxy-generator/src/oiio_processor.py`
- Create: `services/dataengine-functions/oiio-proxy-generator/tests/test_oiio_processor.py`

**Step 1: Write failing tests**

```python
# tests/test_oiio_processor.py
import pytest
import subprocess
from pathlib import Path
from unittest.mock import patch, MagicMock
from src.oiio_processor import OiioProcessor, OiioError


@pytest.fixture
def processor():
    return OiioProcessor()


def test_generate_thumbnail_calls_oiiotool(processor, tmp_path):
    source = str(tmp_path / "test.exr")
    output = str(tmp_path / "thumb.jpg")
    # Create a tiny test EXR using oiiotool (skip if not available)
    result = subprocess.run(
        ["oiiotool", "--create", "64x64", "3", "-o", source],
        capture_output=True,
    )
    if result.returncode != 0:
        pytest.skip("oiiotool not available in test environment")

    processor.generate_thumbnail(source, output, width=64, height=64)
    assert Path(output).exists()
    assert Path(output).stat().st_size > 0


def test_generate_thumbnail_raises_on_missing_input(processor, tmp_path):
    with pytest.raises(OiioError, match="not found"):
        processor.generate_thumbnail(
            "/nonexistent/source.exr",
            str(tmp_path / "thumb.jpg"),
        )


def test_oiiotool_command_structure(processor):
    """Verify the command built by _build_thumbnail_cmd has expected args."""
    cmd = processor._build_thumbnail_cmd(
        source="/input/frame.exr",
        output="/output/thumb.jpg",
        width=256,
        height=256,
    )
    assert "oiiotool" in cmd
    assert "/input/frame.exr" in cmd
    assert "256x256" in " ".join(cmd)
    assert "/output/thumb.jpg" in cmd
```

**Step 2: Run — verify FAIL**

```bash
cd services/dataengine-functions/oiio-proxy-generator
python -m venv .venv && source .venv/bin/activate && pip install -e ".[dev]"
pytest tests/test_oiio_processor.py -v
```

Expected: FAIL — `ModuleNotFoundError: No module named 'src.oiio_processor'`

**Step 3: Implement `src/oiio_processor.py`**

```python
import subprocess
import shutil
from pathlib import Path
from dataclasses import dataclass


class OiioError(Exception):
    pass


@dataclass
class OiioProcessor:
    oiiotool_bin: str = "oiiotool"

    def generate_thumbnail(self, source: str, output: str, width: int = 256, height: int = 256) -> None:
        """Generate a JPEG thumbnail from an EXR/DPX source."""
        if not Path(source).exists():
            raise OiioError(f"Source file not found: {source}")
        cmd = self._build_thumbnail_cmd(source, output, width, height)
        self._run(cmd)

    def generate_proxy(self, source: str, output: str, width: int = 1920, height: int = 1080) -> None:
        """Generate an H.264 proxy MP4 from an EXR/DPX source.

        Uses oiiotool to extract frames, then ffmpeg to encode H.264.
        """
        if not Path(source).exists():
            raise OiioError(f"Source file not found: {source}")
        if not shutil.which("ffmpeg"):
            raise OiioError("ffmpeg not found in PATH — required for proxy encoding")

        # For single frames: convert to PNG intermediate, then encode with ffmpeg
        intermediate = output.replace(".mp4", "_intermediate.png")
        resize_cmd = self._build_thumbnail_cmd(source, intermediate, width, height)
        self._run(resize_cmd)

        ffmpeg_cmd = [
            "ffmpeg", "-y",
            "-i", intermediate,
            "-c:v", "libx264",
            "-preset", "fast",
            "-crf", "23",
            "-pix_fmt", "yuv420p",
            output,
        ]
        self._run(ffmpeg_cmd)
        Path(intermediate).unlink(missing_ok=True)

    def _build_thumbnail_cmd(self, source: str, output: str, width: int, height: int) -> list[str]:
        return [
            self.oiiotool_bin,
            source,
            "--resize", f"{width}x{height}",
            "--compression", "jpeg:85",
            "-o", output,
        ]

    def _run(self, cmd: list[str]) -> None:
        result = subprocess.run(cmd, capture_output=True, text=True)
        if result.returncode != 0:
            raise OiioError(f"oiiotool failed: {result.stderr}")
```

**Step 4: Run tests**

```bash
pytest tests/test_oiio_processor.py -v
```

Expected: PASS (skipping oiiotool tests if binary not available, but `test_oiiotool_command_structure` always passes)

**Step 5: Commit**

```bash
git add services/dataengine-functions/oiio-proxy-generator/src/oiio_processor.py services/dataengine-functions/oiio-proxy-generator/tests/test_oiio_processor.py
git commit -m "feat: implement OiioProcessor for thumbnail and proxy generation"
```

---

### Task 3: Implement `publisher.py` — publish `proxy.generated` CloudEvent

**Files:**
- Create: `services/dataengine-functions/oiio-proxy-generator/src/publisher.py`
- Create: `services/dataengine-functions/oiio-proxy-generator/tests/test_publisher.py`

**Step 1: Write failing tests**

```python
# tests/test_publisher.py
import pytest
import json
from unittest.mock import patch, MagicMock
from src.publisher import publish_proxy_generated, ProxyGeneratedEvent


def test_proxy_generated_event_shape():
    event = ProxyGeneratedEvent(
        asset_id="abc123",
        thumbnail_uri="/vast/thumbnails/abc123.jpg",
        proxy_uri="/vast/proxies/abc123_proxy.mp4",
    )
    payload = event.to_dict()
    assert payload["type"] == "proxy.generated"
    assert payload["asset_id"] == "abc123"
    assert "thumbnail_uri" in payload
    assert "proxy_uri" in payload
    assert "timestamp" in payload


def test_publish_calls_kafka_producer(monkeypatch):
    mock_producer = MagicMock()
    with patch("src.publisher.Producer", return_value=mock_producer):
        publish_proxy_generated(
            asset_id="abc123",
            thumbnail_uri="/vast/thumbnails/abc123.jpg",
            proxy_uri="/vast/proxies/abc123_proxy.mp4",
            broker="localhost:9092",
            topic="assetharbor.proxy",
        )
    mock_producer.produce.assert_called_once()
    call_kwargs = mock_producer.produce.call_args[1]
    assert call_kwargs["topic"] == "assetharbor.proxy"
    value = json.loads(call_kwargs["value"])
    assert value["asset_id"] == "abc123"
    assert value["type"] == "proxy.generated"
    mock_producer.flush.assert_called_once()


def test_publish_dev_mode_does_not_call_kafka():
    """In dev mode, publish logs but does not connect to Kafka."""
    with patch("src.publisher.Producer") as mock_cls:
        publish_proxy_generated(
            asset_id="abc123",
            thumbnail_uri="/tmp/thumb.jpg",
            proxy_uri="/tmp/proxy.mp4",
            broker="localhost:9092",
            topic="assetharbor.proxy",
            dev_mode=True,
        )
        mock_cls.assert_not_called()
```

**Step 2: Run — verify FAIL**

```bash
pytest tests/test_publisher.py -v
```

Expected: FAIL — `ModuleNotFoundError: No module named 'src.publisher'`

**Step 3: Implement `src/publisher.py`**

```python
import json
import logging
import os
from dataclasses import dataclass, field
from datetime import datetime, timezone

log = logging.getLogger("oiio-proxy-generator")


@dataclass
class ProxyGeneratedEvent:
    asset_id: str
    thumbnail_uri: str
    proxy_uri: str
    timestamp: str = field(default_factory=lambda: datetime.now(timezone.utc).isoformat())
    type: str = "proxy.generated"

    def to_dict(self) -> dict:
        return {
            "type": self.type,
            "asset_id": self.asset_id,
            "thumbnail_uri": self.thumbnail_uri,
            "proxy_uri": self.proxy_uri,
            "timestamp": self.timestamp,
        }


def publish_proxy_generated(
    asset_id: str,
    thumbnail_uri: str,
    proxy_uri: str,
    broker: str = "vastbroker:9092",
    topic: str = "assetharbor.proxy",
    dev_mode: bool = False,
) -> None:
    event = ProxyGeneratedEvent(
        asset_id=asset_id,
        thumbnail_uri=thumbnail_uri,
        proxy_uri=proxy_uri,
    )
    payload = json.dumps(event.to_dict()).encode("utf-8")

    if dev_mode or os.environ.get("DEV_MODE", "true").lower() == "true":
        log.info(f"[DEV] proxy.generated event (not publishing to Kafka): {event.to_dict()}")
        return

    from confluent_kafka import Producer  # noqa: PLC0415

    producer = Producer({"bootstrap.servers": broker})
    producer.produce(
        topic=topic,
        key=asset_id.encode("utf-8"),
        value=payload,
        on_delivery=lambda err, msg: log.error(f"Kafka delivery error: {err}") if err else None,
    )
    producer.flush()
    log.info(f"Published proxy.generated for asset {asset_id}")
```

**Step 4: Run tests**

```bash
pytest tests/test_publisher.py -v
```

Expected: PASS (3/3)

**Step 5: Commit**

```bash
git add services/dataengine-functions/oiio-proxy-generator/src/publisher.py services/dataengine-functions/oiio-proxy-generator/tests/test_publisher.py
git commit -m "feat: add Kafka publisher for proxy.generated CloudEvent"
```

---

### Task 4: Register `OiioProxyFunction` in control-plane data-engine registry

**Files:**
- Create: `services/control-plane/src/data-engine/functions/oiio-proxy.ts`
- Modify: `services/control-plane/src/data-engine/registry.ts` (or equivalent registration file)
- Create: `services/control-plane/test/oiio-proxy-function.test.ts`

**Step 1: Read the existing function registry**

```bash
cat services/control-plane/src/data-engine/registry.ts
# or
ls services/control-plane/src/data-engine/
```

Understand how `ExrInspectorFunction` or similar is registered — mirror that pattern exactly.

**Step 2: Write failing test**

```typescript
// test/oiio-proxy-function.test.ts
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { OiioProxyFunction } from "../src/data-engine/functions/oiio-proxy.js";

describe("OiioProxyFunction", () => {
  it("has correct function name", () => {
    const fn = new OiioProxyFunction();
    assert.equal(fn.name, "oiio-proxy-generator");
  });

  it("has correct trigger pattern", () => {
    const fn = new OiioProxyFunction();
    assert.ok(fn.triggerPattern.includes("exr") || fn.triggerPattern.includes("*.exr"));
  });

  it("execute returns expected shape in dev mode", async () => {
    const fn = new OiioProxyFunction({ devMode: true });
    const result = await fn.execute({
      asset_id: "abc123",
      source_uri: "mock://ingest/abc123/hero.exr",
      event_type: "ElementCreated",
    });
    assert.equal(result.status, "completed");
    assert.ok(result.thumbnail_uri);
    assert.ok(result.proxy_uri);
  });
});
```

**Step 3: Run — verify FAIL**

```bash
node --import tsx --test test/oiio-proxy-function.test.ts 2>&1 | tail -20
```

Expected: FAIL — module not found

**Step 4: Create `src/data-engine/functions/oiio-proxy.ts`**

```typescript
export interface DataEngineFunctionContext {
  asset_id: string;
  source_uri: string;
  event_type: string;
}

export interface DataEngineFunctionResult {
  status: "completed" | "failed";
  thumbnail_uri?: string;
  proxy_uri?: string;
  error?: string;
}

interface OiioProxyFunctionOptions {
  devMode?: boolean;
  dataEngineUrl?: string;
}

export class OiioProxyFunction {
  readonly name = "oiio-proxy-generator";
  readonly triggerPattern = "*.exr,*.dpx";

  private devMode: boolean;
  private dataEngineUrl: string;

  constructor(options: OiioProxyFunctionOptions = {}) {
    this.devMode = options.devMode ?? process.env.DEV_MODE !== "false";
    this.dataEngineUrl = options.dataEngineUrl ?? process.env.DATA_ENGINE_URL ?? "http://vastengine:8080";
  }

  async execute(ctx: DataEngineFunctionContext): Promise<DataEngineFunctionResult> {
    if (this.devMode) {
      // Return mock result without calling VAST DataEngine
      return {
        status: "completed",
        thumbnail_uri: `mock://thumbnails/${ctx.asset_id}_thumb.jpg`,
        proxy_uri: `mock://proxies/${ctx.asset_id}_proxy.mp4`,
      };
    }

    // Production: invoke VAST DataEngine REST API to run the containerized function
    const response = await fetch(`${this.dataEngineUrl}/api/v1/functions/${this.name}/invoke`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        asset_id: ctx.asset_id,
        source_uri: ctx.source_uri,
        event_type: ctx.event_type,
      }),
    });

    if (!response.ok) {
      return { status: "failed", error: `DataEngine returned ${response.status}` };
    }

    const result = await response.json() as DataEngineFunctionResult;
    return result;
  }
}
```

**Step 5: Register in the function registry**

In `src/data-engine/registry.ts` (or wherever functions are registered), add:

```typescript
import { OiioProxyFunction } from "./functions/oiio-proxy.js";
// In the registry initialization / array of functions:
registry.register(new OiioProxyFunction());
```

**Step 6: Run all control-plane tests**

```bash
node --import tsx --test test/*.test.ts 2>&1 | tail -10
```

Expected: all PASS

**Step 7: TypeScript check**

```bash
./node_modules/.bin/tsc --noEmit
```

Expected: 0 errors

**Step 8: Commit**

```bash
git add services/control-plane/src/data-engine/functions/oiio-proxy.ts services/control-plane/src/data-engine/registry.ts services/control-plane/test/oiio-proxy-function.test.ts
git commit -m "feat: register OiioProxyFunction in DataEngine registry"
```

---

### Task 5: Handle `proxy.generated` event in control-plane VastEventSubscriber

**Files:**
- Modify: `services/control-plane/src/events/types.ts`
- Modify: `services/control-plane/src/events/processor.ts`
- Create: `services/control-plane/test/proxy-event.test.ts`

**Step 1: Add `ProxyGeneratedEvent` type to `src/events/types.ts`**

```typescript
export interface ProxyGeneratedEvent {
  type: "proxy.generated";
  asset_id: string;
  thumbnail_uri: string;
  proxy_uri: string;
  timestamp: string;
}
```

Also add it to the `AssetHarborEvent` union type.

**Step 2: Write failing test**

```typescript
// test/proxy-event.test.ts
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { processProxyGeneratedEvent } from "../src/events/processor.js";
import { createLocalPersistence } from "../src/persistence/adapters/local.js";

describe("processProxyGeneratedEvent", () => {
  it("updates asset thumbnail_uri and proxy_uri", async () => {
    const persistence = createLocalPersistence();

    // Create a job/asset to update
    const job = await persistence.createJob({
      asset_id: "abc123",
      source_uri: "mock://ingest/abc123/hero.exr",
      status: "completed",
    });

    await processProxyGeneratedEvent(
      {
        type: "proxy.generated",
        asset_id: "abc123",
        thumbnail_uri: "mock://thumbnails/abc123_thumb.jpg",
        proxy_uri: "mock://proxies/abc123_proxy.mp4",
        timestamp: new Date().toISOString(),
      },
      persistence,
    );

    const updated = await persistence.getAsset("abc123");
    assert.equal(updated?.thumbnail_uri, "mock://thumbnails/abc123_thumb.jpg");
    assert.equal(updated?.proxy_uri, "mock://proxies/abc123_proxy.mp4");
  });
});
```

**Step 3: Run — verify FAIL**

```bash
node --import tsx --test test/proxy-event.test.ts 2>&1 | tail -20
```

Expected: FAIL — `processProxyGeneratedEvent` not exported from processor.ts

**Step 4: Add `processProxyGeneratedEvent` to `src/events/processor.ts`**

Open `src/events/processor.ts` and add:

```typescript
import type { ProxyGeneratedEvent } from "./types.js";
import type { PersistenceAdapter } from "../persistence/types.js";

export async function processProxyGeneratedEvent(
  event: ProxyGeneratedEvent,
  persistence: PersistenceAdapter,
): Promise<void> {
  await persistence.updateAsset(event.asset_id, {
    thumbnail_uri: event.thumbnail_uri,
    proxy_uri: event.proxy_uri,
  });
}
```

Also update the main event dispatch function to route `proxy.generated` events to this handler.

**Step 5: Run all tests**

```bash
node --import tsx --test test/*.test.ts 2>&1 | tail -10
```

Expected: all PASS

**Step 6: TypeScript check**

```bash
./node_modules/.bin/tsc --noEmit
```

Expected: 0 errors

**Step 7: Commit**

```bash
git add services/control-plane/src/events/types.ts services/control-plane/src/events/processor.ts services/control-plane/test/proxy-event.test.ts
git commit -m "feat: handle proxy.generated event, update asset thumbnail and proxy URIs"
```

---

### Task 6: Dockerfile for oiio-proxy-generator

**Files:**
- Create: `services/dataengine-functions/oiio-proxy-generator/Dockerfile`

**Step 1: Write `Dockerfile`**

```dockerfile
FROM python:3.12-slim

# Install system dependencies: oiiotool, ffmpeg
RUN apt-get update && apt-get install -y --no-install-recommends \
    openimageio-tools \
    python3-openimageio \
    ffmpeg \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY pyproject.toml .
RUN pip install --no-cache-dir -e .

COPY src/ src/

ENV DEV_MODE=false
ENV KAFKA_BROKER=vastbroker:9092
ENV KAFKA_TOPIC=assetharbor.proxy

# VAST DataEngine calls: python -m src.function
CMD ["python", "-m", "src.function"]
```

**Step 2: Build and verify**

```bash
docker build -t oiio-proxy-generator services/dataengine-functions/oiio-proxy-generator/
```

Expected: BUILD successful (oiiotool and ffmpeg installed)

**Step 3: Commit**

```bash
git add services/dataengine-functions/oiio-proxy-generator/Dockerfile
git commit -m "feat: add Dockerfile for oiio-proxy-generator DataEngine function"
```
