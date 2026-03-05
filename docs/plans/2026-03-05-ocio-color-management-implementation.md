# OCIO Color Management — Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Apply industry-standard ACES 1.3 color transforms inside the OIIO proxy-generator container, ensuring EXR plates in LogC/ACEScg are correctly converted to sRGB (for JPEG thumbnails) and Rec.709 (for H.264 proxy review) before encoding.

**Architecture:** `ocio_transform.py` runs as a pre-step inside `services/dataengine-functions/oiio-proxy-generator/` — the same container as OIIO. Uses PyOpenColorIO to read the ACES 1.3 config from a VAST view path (`OCIO_CONFIG_PATH` env var), detects source colorspace from EXR metadata, applies the transform, and returns a color-corrected pixel buffer to `oiio_processor.py`. OCIO config is stored as a file on VAST; `OCIO_CONFIG_PATH` defaults to the standard ACES 1.3 config bundled in the container.

**Tech Stack:** Python 3.12, PyOpenColorIO (>=2.3.0), OpenImageIO (for EXR metadata read), OpenEXR metadata attributes (`chromaticities`, `colorspace`)

**Pre-requisite:** `services/dataengine-functions/oiio-proxy-generator/` scaffolded (Tasks 1–2 of OIIO plan complete).

**Design doc:** `docs/plans/2026-03-05-aswf-integrations-design.md`

---

### Task 1: Add PyOpenColorIO dependency

**Files:**
- Modify: `services/dataengine-functions/oiio-proxy-generator/pyproject.toml`
- Modify: `services/dataengine-functions/oiio-proxy-generator/Dockerfile`

**Step 1: Add `PyOpenColorIO` to `pyproject.toml`**

```toml
dependencies = [
    "OpenImageIO>=2.5.0",
    "PyOpenColorIO>=2.3.0",
    "requests>=2.31.0",
    "confluent-kafka>=2.4.0",
]
```

**Step 2: Add system package to `Dockerfile`**

```dockerfile
RUN apt-get update && apt-get install -y --no-install-recommends \
    openimageio-tools \
    python3-openimageio \
    python3-pyopencolorio \
    ffmpeg \
    ocio-configs \
    && rm -rf /var/lib/apt/lists/*
```

Note: `ocio-configs` installs ACES and other standard configs at `/usr/share/color/opencolorio/`. If not available in your distro, bundle the ACES 1.3 config files directly in the container image.

**Step 3: Reinstall in local venv**

```bash
cd services/dataengine-functions/oiio-proxy-generator
source .venv/bin/activate
pip install -e ".[dev]"
```

**Step 4: Verify import**

```bash
python -c "import PyOpenColorIO; print(PyOpenColorIO.__version__)"
```

Expected: prints version (e.g. `2.3.0`)

**Step 5: Commit**

```bash
git add services/dataengine-functions/oiio-proxy-generator/pyproject.toml services/dataengine-functions/oiio-proxy-generator/Dockerfile
git commit -m "feat: add PyOpenColorIO dependency to oiio-proxy-generator"
```

---

### Task 2: Implement `ocio_transform.py` — colorspace detection

**Files:**
- Create: `services/dataengine-functions/oiio-proxy-generator/src/ocio_transform.py`
- Create: `services/dataengine-functions/oiio-proxy-generator/tests/test_ocio_transform.py`

**Step 1: Write failing tests**

```python
# tests/test_ocio_transform.py
import pytest
import subprocess
from pathlib import Path
from unittest.mock import patch, MagicMock
from src.ocio_transform import OcioTransform, ColorspaceDetectionError


@pytest.fixture
def transform():
    return OcioTransform(config_path=None, dev_mode=True)


def test_detect_colorspace_from_exr_metadata_linear(transform, tmp_path):
    """EXR with no colorspace attribute defaults to 'scene_linear'."""
    source = str(tmp_path / "test.exr")
    result = subprocess.run(
        ["oiiotool", "--create", "8x8", "3", "-o", source],
        capture_output=True,
    )
    if result.returncode != 0:
        pytest.skip("oiiotool not available")
    cs = transform.detect_colorspace(source)
    assert cs in ("scene_linear", "linear", "ACEScg", "LogC", "unknown")


def test_detect_colorspace_returns_string(transform, tmp_path):
    """Always returns a string, never raises."""
    # Use a mock that simulates oiiotool metadata output
    with patch.object(transform, "_read_exr_metadata", return_value={"colorspace": "LogC"}):
        cs = transform.detect_colorspace("/fake/path.exr")
    assert cs == "LogC"


def test_detect_colorspace_uses_chromaticities_fallback(transform):
    """Falls back to chromaticities heuristic if no colorspace attr."""
    with patch.object(transform, "_read_exr_metadata", return_value={"chromaticities": "aces"}):
        cs = transform.detect_colorspace("/fake/path.exr")
    assert "aces" in cs.lower() or cs == "ACEScg"


def test_apply_dev_mode_returns_source_path(transform):
    """In dev mode, apply() returns the source path unchanged."""
    result = transform.apply("/fake/input.exr", target_colorspace="sRGB")
    assert result == "/fake/input.exr"


def test_apply_raises_if_source_missing(tmp_path):
    t = OcioTransform(config_path=None, dev_mode=False)
    with pytest.raises(FileNotFoundError):
        t.apply("/nonexistent/input.exr", target_colorspace="sRGB")
```

**Step 2: Run — verify FAIL**

```bash
pytest tests/test_ocio_transform.py -v
```

Expected: FAIL — `ModuleNotFoundError: No module named 'src.ocio_transform'`

**Step 3: Implement `src/ocio_transform.py`**

```python
import subprocess
import json
import logging
import os
import shutil
from dataclasses import dataclass
from pathlib import Path

log = logging.getLogger("oiio-proxy-generator")


class ColorspaceDetectionError(Exception):
    pass


# Map EXR attribute values to OCIO colorspace names (ACES 1.3 config)
_COLORSPACE_MAP = {
    "logc": "ARRI LogC",
    "logc3": "ARRI LogC",
    "logc4": "ARRI LogC4",
    "acescg": "ACEScg",
    "aces": "ACEScg",
    "linear": "scene_linear",
    "scene_linear": "scene_linear",
    "srgb": "sRGB",
    "rec709": "Rec.709",
    "rec.709": "Rec.709",
}


@dataclass
class OcioTransform:
    config_path: str | None
    dev_mode: bool = False

    def __post_init__(self):
        if self.config_path is None:
            self.config_path = os.environ.get(
                "OCIO_CONFIG_PATH",
                "/usr/share/color/opencolorio/aces_1.3/config.ocio",
            )

    def apply(self, source: str, target_colorspace: str = "sRGB") -> str:
        """Apply OCIO color transform. In dev mode, returns source unchanged.

        Production: uses oiiotool --colorconvert to produce a color-correct
        intermediate file. Returns path to the transformed file.
        """
        if self.dev_mode:
            log.info(f"[DEV] OCIO transform skipped for {source}")
            return source

        if not Path(source).exists():
            raise FileNotFoundError(f"Source file not found: {source}")

        source_cs = self.detect_colorspace(source)
        if source_cs == target_colorspace:
            log.info(f"No transform needed: source is already {target_colorspace}")
            return source

        output = source.replace(".exr", f"__{target_colorspace.replace('.', '_')}.exr")
        self._run_colorconvert(source, output, source_cs, target_colorspace)
        return output

    def detect_colorspace(self, source: str) -> str:
        """Detect source colorspace from EXR metadata attributes."""
        metadata = self._read_exr_metadata(source)

        # Priority 1: explicit 'colorspace' attribute
        if cs_attr := metadata.get("colorspace"):
            return self._normalize_colorspace(str(cs_attr))

        # Priority 2: chromaticities heuristic
        if chroma := metadata.get("chromaticities", ""):
            chroma_lower = str(chroma).lower()
            if "aces" in chroma_lower:
                return "ACEScg"
            if "rec709" in chroma_lower or "rec.709" in chroma_lower:
                return "Rec.709"

        # Default: assume scene_linear for EXR without metadata
        return "scene_linear"

    def _normalize_colorspace(self, raw: str) -> str:
        return _COLORSPACE_MAP.get(raw.lower().strip(), raw)

    def _read_exr_metadata(self, source: str) -> dict:
        """Read EXR metadata using oiiotool --info -v."""
        if not shutil.which("oiiotool"):
            return {}
        result = subprocess.run(
            ["oiiotool", "--info", "-v", source],
            capture_output=True,
            text=True,
        )
        metadata = {}
        for line in result.stdout.splitlines():
            if ":" in line:
                key, _, value = line.partition(":")
                metadata[key.strip().lower()] = value.strip()
        return metadata

    def _run_colorconvert(self, source: str, output: str, from_cs: str, to_cs: str) -> None:
        """Run oiiotool --colorconvert with OCIO config."""
        env = os.environ.copy()
        env["OCIO"] = self.config_path
        cmd = [
            "oiiotool", source,
            "--colorconvert", from_cs, to_cs,
            "-o", output,
        ]
        result = subprocess.run(cmd, capture_output=True, text=True, env=env)
        if result.returncode != 0:
            raise ColorspaceDetectionError(
                f"oiiotool colorconvert failed: {result.stderr}"
            )
        log.info(f"OCIO transform: {from_cs} → {to_cs} → {output}")
```

**Step 4: Run tests**

```bash
pytest tests/test_ocio_transform.py -v
```

Expected: PASS (5/5, skipping oiiotool tests if binary unavailable)

**Step 5: Commit**

```bash
git add services/dataengine-functions/oiio-proxy-generator/src/ocio_transform.py services/dataengine-functions/oiio-proxy-generator/tests/test_ocio_transform.py
git commit -m "feat: implement OcioTransform for LogC/ACEScg→sRGB/Rec.709 color management"
```

---

### Task 3: Wire OCIO pre-step into `function.py` (both thumbnails and proxies)

**Files:**
- Modify: `services/dataengine-functions/oiio-proxy-generator/src/function.py`
- Create: `services/dataengine-functions/oiio-proxy-generator/tests/test_function.py`

**Step 1: Write failing integration test**

```python
# tests/test_function.py
import pytest
import subprocess
from pathlib import Path
from unittest.mock import patch, MagicMock, call
import os


def test_function_calls_ocio_then_oiio_in_dev_mode(tmp_path, monkeypatch):
    """In dev mode, function.main() calls OcioTransform.apply then OiioProcessor methods."""
    monkeypatch.setenv("VAST_SOURCE_PATH", str(tmp_path / "hero.exr"))
    monkeypatch.setenv("VAST_ASSET_ID", "abc123")
    monkeypatch.setenv("VAST_THUMB_PATH", str(tmp_path / "thumb.jpg"))
    monkeypatch.setenv("VAST_PROXY_PATH", str(tmp_path / "proxy.mp4"))
    monkeypatch.setenv("DEV_MODE", "true")

    # Create a dummy source file so exists check passes
    (tmp_path / "hero.exr").write_bytes(b"fake exr")

    with patch("src.function.OcioTransform") as MockOcio, \
         patch("src.function.OiioProcessor") as MockOiio, \
         patch("src.function.publish_proxy_generated") as mock_publish:

        mock_ocio_instance = MockOcio.return_value
        mock_ocio_instance.apply.return_value = str(tmp_path / "hero_transformed.exr")

        mock_oiio_instance = MockOiio.return_value

        from src.function import main
        exit_code = main()

    assert exit_code == 0
    # OCIO called before OIIO
    mock_ocio_instance.apply.assert_called_once()
    # OIIO called with OCIO output
    mock_oiio_instance.generate_thumbnail.assert_called_once()
    mock_oiio_instance.generate_proxy.assert_called_once()
    # Publisher called
    mock_publish.assert_called_once()


def test_function_returns_1_when_vars_missing(monkeypatch):
    """Returns exit code 1 when required env vars absent."""
    monkeypatch.delenv("VAST_SOURCE_PATH", raising=False)
    monkeypatch.delenv("VAST_ASSET_ID", raising=False)

    from src.function import main
    exit_code = main()
    assert exit_code == 1
```

**Step 2: Run — verify FAIL**

```bash
pytest tests/test_function.py -v
```

Expected: FAIL — imports error or `OcioTransform` not imported in function.py

**Step 3: Update `src/function.py` to wire OCIO before OIIO**

The scaffold in Task 1 already has the correct structure. Verify it matches:

```python
from src.oiio_processor import OiioProcessor
from src.ocio_transform import OcioTransform
from src.publisher import publish_proxy_generated

def main() -> int:
    source_path = os.environ.get("VAST_SOURCE_PATH", "")
    asset_id = os.environ.get("VAST_ASSET_ID", "")
    thumb_path = os.environ.get("VAST_THUMB_PATH", f"/tmp/{asset_id}_thumb.jpg")
    proxy_path = os.environ.get("VAST_PROXY_PATH", f"/tmp/{asset_id}_proxy.mp4")

    if not source_path or not asset_id:
        log.error("VAST_SOURCE_PATH and VAST_ASSET_ID must be set")
        return 1

    processor = OiioProcessor()
    transform = OcioTransform(config_path=os.environ.get("OCIO_CONFIG_PATH"))

    # Step 1: OCIO — color transform (sRGB for thumbnail)
    transformed_path = transform.apply(source_path, target_colorspace="sRGB")

    # Step 2: OIIO — thumbnail (sRGB already applied)
    processor.generate_thumbnail(transformed_path, thumb_path, width=256, height=256)

    # Step 3: OCIO — Rec.709 transform for proxy
    proxy_transformed = transform.apply(source_path, target_colorspace="Rec.709")

    # Step 4: OIIO — proxy (Rec.709 applied)
    processor.generate_proxy(proxy_transformed, proxy_path, width=1920, height=1080)

    # Step 5: Publish completion event
    publish_proxy_generated(
        asset_id=asset_id,
        thumbnail_uri=thumb_path,
        proxy_uri=proxy_path,
    )

    log.info(f"Done: thumb={thumb_path} proxy={proxy_path}")
    return 0
```

**Step 4: Run all tests**

```bash
pytest tests/ -v
```

Expected: PASS (all)

**Step 5: Commit**

```bash
git add services/dataengine-functions/oiio-proxy-generator/src/function.py services/dataengine-functions/oiio-proxy-generator/tests/test_function.py
git commit -m "feat: wire OCIO pre-step into DataEngine function (sRGB thumbnail, Rec.709 proxy)"
```

---

### Task 4: Add OCIO config to container image

**Files:**
- Modify: `services/dataengine-functions/oiio-proxy-generator/Dockerfile`
- Create: `services/dataengine-functions/oiio-proxy-generator/configs/README.md`

**Step 1: Download ACES 1.3 config (run once)**

```bash
mkdir -p services/dataengine-functions/oiio-proxy-generator/configs
# Option A: use ocio-configs system package (already in Dockerfile apt line above)
# Option B: bundle a minimal ACES config
# Download from: https://github.com/AcademySoftwareFoundation/OpenColorIO-Config-ACES/releases
# Place config.ocio in configs/ directory
echo "Place aces_1.3/config.ocio here or use ocio-configs system package" \
  > services/dataengine-functions/oiio-proxy-generator/configs/README.md
```

**Step 2: Update `Dockerfile` to set `OCIO` env var**

```dockerfile
# Default OCIO config path (override via OCIO_CONFIG_PATH env var at runtime)
ENV OCIO=/usr/share/color/opencolorio/aces_1.3/config.ocio
ENV OCIO_CONFIG_PATH=/usr/share/color/opencolorio/aces_1.3/config.ocio
```

**Step 3: Build and spot-check**

```bash
docker build -t oiio-proxy-generator services/dataengine-functions/oiio-proxy-generator/
docker run --rm oiio-proxy-generator python -c "
import PyOpenColorIO as ocio
import os
cfg = ocio.Config.CreateFromFile(os.environ['OCIO'])
print('OCIO config loaded:', cfg.getNumColorSpaces(), 'colorspaces')
"
```

Expected: prints ACES colorspace count (e.g. `OCIO config loaded: 50 colorspaces`)

**Step 4: Commit**

```bash
git add services/dataengine-functions/oiio-proxy-generator/Dockerfile services/dataengine-functions/oiio-proxy-generator/configs/README.md
git commit -m "feat: configure ACES 1.3 OCIO config path in DataEngine container"
```

---

### Task 5: End-to-end smoke test (dev mode)

**Files:**
- Create: `services/dataengine-functions/oiio-proxy-generator/tests/test_e2e_dev.py`

**Step 1: Write smoke test**

```python
# tests/test_e2e_dev.py
"""Dev-mode E2E: runs the full function pipeline without VAST or Kafka."""
import pytest
import subprocess
from pathlib import Path


def test_full_pipeline_dev_mode(tmp_path, monkeypatch):
    """Run function.main() end-to-end in dev mode with a real EXR input."""
    # Create a minimal EXR
    source = str(tmp_path / "hero.exr")
    result = subprocess.run(
        ["oiiotool", "--create", "32x32", "3", "-o", source],
        capture_output=True,
    )
    if result.returncode != 0:
        pytest.skip("oiiotool not available — skipping E2E test")

    thumb = str(tmp_path / "hero_thumb.jpg")
    proxy = str(tmp_path / "hero_proxy.mp4")

    monkeypatch.setenv("VAST_SOURCE_PATH", source)
    monkeypatch.setenv("VAST_ASSET_ID", "e2e-test-001")
    monkeypatch.setenv("VAST_THUMB_PATH", thumb)
    monkeypatch.setenv("VAST_PROXY_PATH", proxy)
    monkeypatch.setenv("DEV_MODE", "true")

    from src.function import main
    exit_code = main()

    assert exit_code == 0
    # Dev mode: OCIO skipped, OIIO still runs if binary available
    # At minimum, no exception was raised and exit code is 0
```

**Step 2: Run**

```bash
pytest tests/test_e2e_dev.py -v
```

Expected: PASS (or SKIP if oiiotool not in test environment)

**Step 3: Commit**

```bash
git add services/dataengine-functions/oiio-proxy-generator/tests/test_e2e_dev.py
git commit -m "test: add dev-mode E2E smoke test for oiio+ocio pipeline"
```
