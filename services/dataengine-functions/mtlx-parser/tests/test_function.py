"""Tests for mtlx-parser DataEngine function entrypoint."""

import pytest
from unittest.mock import patch, MagicMock


class TestMain:
    @patch.dict("os.environ", {}, clear=True)
    def test_missing_env_vars_returns_1(self):
        from src.function import main
        assert main() == 1

    @patch.dict("os.environ", {"VAST_SOURCE_PATH": "/data/test.mtlx"}, clear=True)
    def test_missing_asset_id_returns_1(self):
        from src.function import main
        assert main() == 1

    @patch("src.function.publish_completion")
    @patch("src.function.parse_mtlx")
    @patch.dict("os.environ", {
        "VAST_SOURCE_PATH": "/data/test.mtlx",
        "VAST_ASSET_ID": "abc123",
    })
    def test_success_publishes_metadata(self, mock_parse, mock_publish):
        mock_parse.return_value = {"material_name": "hero_mtl", "looks": ["default"]}
        from src.function import main
        assert main() == 0
        mock_publish.assert_called_once_with(
            function_name="mtlx_parser",
            asset_id="abc123",
            success=True,
            metadata={"material_name": "hero_mtl", "looks": ["default"]},
        )

    @patch("src.function.publish_completion")
    @patch("src.function.parse_mtlx")
    @patch.dict("os.environ", {
        "VAST_SOURCE_PATH": "/data/test.mtlx",
        "VAST_ASSET_ID": "abc123",
    })
    def test_file_not_found_publishes_failure(self, mock_parse, mock_publish):
        mock_parse.side_effect = FileNotFoundError("/data/test.mtlx")
        from src.function import main
        assert main() == 1
        mock_publish.assert_called_once_with(
            function_name="mtlx_parser",
            asset_id="abc123",
            success=False,
            error="/data/test.mtlx",
        )

    @patch("src.function.publish_completion")
    @patch("src.function.parse_mtlx")
    @patch.dict("os.environ", {
        "VAST_SOURCE_PATH": "/data/test.mtlx",
        "VAST_ASSET_ID": "abc123",
    })
    def test_unexpected_error_publishes_failure(self, mock_parse, mock_publish):
        mock_parse.side_effect = RuntimeError("corrupt file")
        from src.function import main
        assert main() == 1
        mock_publish.assert_called_once_with(
            function_name="mtlx_parser",
            asset_id="abc123",
            success=False,
            error="corrupt file",
        )
