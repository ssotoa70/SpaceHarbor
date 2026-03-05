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
    # Thumbnail should be generated
    assert Path(thumb).exists(), "Thumbnail was not generated"
    assert Path(thumb).stat().st_size > 0
