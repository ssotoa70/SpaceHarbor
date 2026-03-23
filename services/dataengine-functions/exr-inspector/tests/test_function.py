"""Tests for exr-inspector DataEngine function entrypoint."""

import pytest
from unittest.mock import patch, MagicMock


class TestMain:
    @patch.dict("os.environ", {}, clear=True)
    def test_missing_env_vars_returns_1(self):
        from src.function import main
        assert main() == 1

    @patch.dict("os.environ", {"VAST_SOURCE_PATH": "/data/test.exr"}, clear=True)
    def test_missing_asset_id_returns_1(self):
        from src.function import main
        assert main() == 1

    @patch.dict("os.environ", {"VAST_ASSET_ID": "abc123"}, clear=True)
    def test_missing_source_path_returns_1(self):
        from src.function import main
        assert main() == 1

    @patch("src.function.publish_completion")
    @patch("src.function.extract_exr_metadata")
    @patch.dict("os.environ", {
        "VAST_SOURCE_PATH": "/data/test.exr",
        "VAST_ASSET_ID": "abc123",
    })
    def test_success_publishes_metadata(self, mock_extract, mock_publish):
        mock_extract.return_value = {
            "resolution": {"width": 4096, "height": 2160},
            "codec": "exr",
        }
        from src.function import main
        assert main() == 0
        mock_publish.assert_called_once_with(
            function_name="exr_inspector",
            asset_id="abc123",
            success=True,
            metadata={"resolution": {"width": 4096, "height": 2160}, "codec": "exr"},
        )

    @patch("src.function.publish_completion")
    @patch("src.function.extract_exr_metadata")
    @patch.dict("os.environ", {
        "VAST_SOURCE_PATH": "/data/test.exr",
        "VAST_ASSET_ID": "abc123",
    })
    def test_inspector_error_publishes_failure(self, mock_extract, mock_publish):
        from src.inspector import ExrInspectorError
        mock_extract.side_effect = ExrInspectorError("oiiotool not found in PATH")
        from src.function import main
        assert main() == 1
        mock_publish.assert_called_once_with(
            function_name="exr_inspector",
            asset_id="abc123",
            success=False,
            error="oiiotool not found in PATH",
        )

    @patch("src.function.publish_completion")
    @patch("src.function.extract_exr_metadata")
    @patch.dict("os.environ", {
        "VAST_SOURCE_PATH": "/data/test.exr",
        "VAST_ASSET_ID": "abc123",
    })
    def test_unexpected_error_publishes_failure(self, mock_extract, mock_publish):
        mock_extract.side_effect = RuntimeError("disk full")
        from src.function import main
        assert main() == 1
        mock_publish.assert_called_once_with(
            function_name="exr_inspector",
            asset_id="abc123",
            success=False,
            error="disk full",
        )
