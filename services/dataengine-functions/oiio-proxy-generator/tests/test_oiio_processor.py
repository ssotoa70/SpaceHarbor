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
