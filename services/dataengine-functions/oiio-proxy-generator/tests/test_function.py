import pytest
import subprocess
from pathlib import Path
from unittest.mock import patch, MagicMock
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
    # OCIO called before OIIO (twice: sRGB thumbnail + Rec.709 proxy)
    assert mock_ocio_instance.apply.call_count == 2
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
