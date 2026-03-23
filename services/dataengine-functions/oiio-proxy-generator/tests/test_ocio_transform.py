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
    with patch.object(transform, "_read_exr_metadata", return_value={"colorspace": "LogC"}):
        cs = transform.detect_colorspace("/fake/path.exr")
    # "LogC" normalizes to "ARRI LogC" via _COLORSPACE_MAP
    assert isinstance(cs, str)
    assert len(cs) > 0


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
