"""Unit tests for provenance-recorder function entrypoint."""

import os
from unittest.mock import patch

import pytest

# Ensure permissive base dirs for test paths
os.environ.setdefault("SPACEHARBOR_MEDIA_BASE_DIR", "/")


class TestMainEntrypoint:
    """Tests for the main() function."""

    def test_missing_source_path_returns_1(self):
        env = {"VAST_SOURCE_PATH": "", "VAST_ASSET_ID": "abc123"}
        with patch.dict(os.environ, env, clear=False):
            from src.function import main
            assert main() == 1

    def test_missing_asset_id_returns_1(self):
        env = {"VAST_SOURCE_PATH": "/data/media/test.exr", "VAST_ASSET_ID": ""}
        with patch.dict(os.environ, env, clear=False):
            from src.function import main
            assert main() == 1

    def test_invalid_asset_id_returns_1(self):
        env = {
            "VAST_SOURCE_PATH": "/data/media/test.exr",
            "VAST_ASSET_ID": "../../../etc/passwd",
        }
        with patch.dict(os.environ, env, clear=False):
            from src.function import main
            assert main() == 1

    def test_successful_extraction(self, tmp_path):
        f = tmp_path / "test.exr"
        f.write_bytes(b"\x00" * 64)

        env = {
            "VAST_SOURCE_PATH": str(f),
            "VAST_ASSET_ID": "asset-001",
            "VAST_PROJECT_ID": "proj-1",
            "VAST_SHOT_ID": "shot-1",
        }

        with patch.dict(os.environ, env, clear=False), \
             patch("src.function.publish_completion") as mock_pub, \
             patch("src.function.extract_provenance") as mock_extract:
            mock_extract.return_value = {
                "vast_storage_path": str(f),
                "file_size_bytes": 64,
                "source_host": "test-host",
                "source_process_id": 1234,
                "software": "Nuke",
            }

            from src.function import main
            result = main()

        assert result == 0
        mock_pub.assert_called_once()
        call_kwargs = mock_pub.call_args
        assert call_kwargs[1]["function_name"] == "provenance_recorder"
        assert call_kwargs[1]["success"] is True
        metadata = call_kwargs[1]["metadata"]
        assert metadata["project_id"] == "proj-1"
        assert metadata["shot_id"] == "shot-1"
        assert metadata["software"] == "Nuke"

    def test_extraction_failure_publishes_error(self):
        from src.recorder import ProvenanceRecorderError

        env = {
            "VAST_SOURCE_PATH": "/data/media/missing.exr",
            "VAST_ASSET_ID": "asset-002",
        }

        with patch.dict(os.environ, env, clear=False), \
             patch("src.function.publish_completion") as mock_pub, \
             patch("src.function.extract_provenance") as mock_extract:
            mock_extract.side_effect = ProvenanceRecorderError("File not found")

            from src.function import main
            result = main()

        assert result == 1
        mock_pub.assert_called_once()
        assert mock_pub.call_args[1]["success"] is False
        assert "File not found" in mock_pub.call_args[1]["error"]
