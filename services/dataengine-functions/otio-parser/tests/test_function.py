"""Tests for otio-parser DataEngine function entrypoint."""

import pytest
from unittest.mock import patch, MagicMock


class TestMain:
    @patch.dict("os.environ", {}, clear=True)
    def test_missing_env_vars_returns_1(self):
        from src.function import main
        assert main() == 1

    @patch.dict("os.environ", {"VAST_SOURCE_PATH": "/data/test.otio"}, clear=True)
    def test_missing_asset_id_returns_1(self):
        from src.function import main
        assert main() == 1

    @patch("src.function.publish_completion")
    @patch("src.function.parse_timeline")
    @patch.dict("os.environ", {
        "VAST_SOURCE_PATH": "/data/test.otio",
        "VAST_ASSET_ID": "abc123",
    })
    def test_success_publishes_metadata(self, mock_parse, mock_publish):
        mock_parse.return_value = {
            "timeline_name": "edit_v3",
            "tracks": [{"name": "V1", "clips": []}],
        }
        from src.function import main
        assert main() == 0
        mock_publish.assert_called_once_with(
            function_name="otio_parser",
            asset_id="abc123",
            success=True,
            metadata={
                "timeline_name": "edit_v3",
                "tracks": [{"name": "V1", "clips": []}],
            },
        )

    @patch("src.function.publish_completion")
    @patch("src.function.parse_timeline")
    @patch.dict("os.environ", {
        "VAST_SOURCE_PATH": "/data/test.otio",
        "VAST_ASSET_ID": "abc123",
    })
    def test_file_not_found_publishes_failure(self, mock_parse, mock_publish):
        mock_parse.side_effect = FileNotFoundError("/data/test.otio")
        from src.function import main
        assert main() == 1
        mock_publish.assert_called_once_with(
            function_name="otio_parser",
            asset_id="abc123",
            success=False,
            error="/data/test.otio",
        )

    @patch("src.function.publish_completion")
    @patch("src.function.parse_timeline")
    @patch.dict("os.environ", {
        "VAST_SOURCE_PATH": "/data/test.otio",
        "VAST_ASSET_ID": "abc123",
    })
    def test_unexpected_error_publishes_failure(self, mock_parse, mock_publish):
        mock_parse.side_effect = RuntimeError("corrupt timeline")
        from src.function import main
        assert main() == 1
        mock_publish.assert_called_once_with(
            function_name="otio_parser",
            asset_id="abc123",
            success=False,
            error="corrupt timeline",
        )
