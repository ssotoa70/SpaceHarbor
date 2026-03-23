"""Tests for timeline-conformer DataEngine function."""

import pytest
from unittest.mock import patch, MagicMock
import json
import sys


class TestExtractShotName:
    """Test shot name extraction from clip names."""

    def test_seq_shot_format(self):
        """Test extraction of SEQ_SH format."""
        from src.function import extract_shot_name

        result = extract_shot_name("SEQ010_SH020_comp_v003")
        assert result == "SEQ010_SH020"

    def test_seq_shot_lowercase(self):
        """Test extraction with lowercase sequence/shot codes."""
        from src.function import extract_shot_name

        result = extract_shot_name("seq010_sh020")
        assert result == "seq010_sh020"

    def test_seq_shot_mixed_case(self):
        """Test extraction with mixed case."""
        from src.function import extract_shot_name

        result = extract_shot_name("SeQ010_Sh020_output")
        assert result == "SeQ010_Sh020"

    def test_seq_shot_with_dash_separator(self):
        """Test extraction with dash separators."""
        from src.function import extract_shot_name

        result = extract_shot_name("SQ010-SH020-comp")
        assert result == "SQ010-SH020"

    def test_seq_shot_with_show_prefix(self):
        """Test extraction when clip has show prefix."""
        from src.function import extract_shot_name

        result = extract_shot_name("myshow_SQ010_SH020")
        assert result == "SQ010_SH020"

    def test_seq_shot_at_clip_start(self):
        """Test extraction when seq_shot is at start of clip name."""
        from src.function import extract_shot_name

        result = extract_shot_name("SQ001_SH005_lighting")
        assert result == "SQ001_SH005"

    def test_no_shot_pattern(self):
        """Test when clip name has no shot pattern."""
        from src.function import extract_shot_name

        result = extract_shot_name("random_clip_name_v001")
        assert result is None

    def test_single_shot_component(self):
        """Test that single shot component matches (e.g., SH040_final)."""
        from src.function import extract_shot_name

        # Single shot format is supported
        result = extract_shot_name("SH020_lighting")
        assert result == "SH020"

        result = extract_shot_name("sh040")
        assert result == "sh040"

    def test_three_digit_codes(self):
        """Test with three-digit sequence/shot codes."""
        from src.function import extract_shot_name

        result = extract_shot_name("SQ100_SH200_final")
        assert result == "SQ100_SH200"

    def test_four_digit_codes(self):
        """Test with four-digit codes."""
        from src.function import extract_shot_name

        result = extract_shot_name("SEQ0100_SH0200_master")
        assert result == "SEQ0100_SH0200"

    def test_empty_string(self):
        """Test with empty clip name."""
        from src.function import extract_shot_name

        result = extract_shot_name("")
        assert result is None


class TestConformClips:
    """Test clip-to-shot matching logic."""

    def test_single_clip_match(self):
        """Test matching a single clip to hierarchy."""
        from src.function import conform_clips

        clips = [
            {"clip_name": "SQ010_SH020_comp_v001"}
        ]
        hierarchy_shots = {
            "SQ010_SH020": {"id": "shot-uuid-123", "code": "SQ010_SH020"}
        }

        result = conform_clips(clips, hierarchy_shots)

        assert len(result) == 1
        assert result[0]["conformStatus"] == "matched"
        assert result[0]["shotId"] == "shot-uuid-123"
        assert result[0]["extractedShotName"] == "SQ010_SH020"

    def test_multiple_clips_mixed_match(self):
        """Test matching multiple clips with some matching and some not."""
        from src.function import conform_clips

        clips = [
            {"clip_name": "SQ010_SH020_comp"},
            {"clip_name": "SQ010_SH030_comp"},
            {"clip_name": "random_clip_name"},
        ]
        hierarchy_shots = {
            "SQ010_SH020": {"id": "shot-1"},
            "SQ010_SH030": {"id": "shot-2"},
        }

        result = conform_clips(clips, hierarchy_shots)

        assert len(result) == 3
        assert result[0]["conformStatus"] == "matched"
        assert result[1]["conformStatus"] == "matched"
        assert result[2]["conformStatus"] == "unmatched"
        assert result[2]["shotId"] is None

    def test_case_insensitive_matching(self):
        """Test that shot matching is case-insensitive."""
        from src.function import conform_clips

        clips = [
            {"clip_name": "seq010_sh020_comp"}
        ]
        hierarchy_shots = {
            "SEQ010_SH020": {"id": "shot-uuid"}
        }

        result = conform_clips(clips, hierarchy_shots)

        assert result[0]["conformStatus"] == "matched"

    def test_uppercase_matching_lowercase_hierarchy(self):
        """Test matching uppercase clip names to lowercase hierarchy."""
        from src.function import conform_clips

        clips = [
            {"clip_name": "SQ010_SH020_MASTER"}
        ]
        hierarchy_shots = {
            "sq010_sh020": {"id": "shot-lowercase"}
        }

        result = conform_clips(clips, hierarchy_shots)

        assert result[0]["conformStatus"] == "matched"

    def test_empty_hierarchy(self):
        """Test conforming with empty hierarchy."""
        from src.function import conform_clips

        clips = [
            {"clip_name": "SQ010_SH020_comp"},
            {"clip_name": "SQ010_SH030_comp"},
        ]

        result = conform_clips(clips, {})

        assert all(r["conformStatus"] == "unmatched" for r in result)
        assert all(r["shotId"] is None for r in result)

    def test_empty_clips(self):
        """Test conforming empty clips list."""
        from src.function import conform_clips

        hierarchy_shots = {"SQ010_SH020": {"id": "shot-123"}}

        result = conform_clips([], hierarchy_shots)

        assert result == []

    def test_clip_with_clipname_key(self):
        """Test handling clipName key (alternative to clip_name)."""
        from src.function import conform_clips

        clips = [
            {"clipName": "SQ010_SH020_comp"}  # camelCase
        ]
        hierarchy_shots = {
            "SQ010_SH020": {"id": "shot-uuid"}
        }

        result = conform_clips(clips, hierarchy_shots)

        assert result[0]["conformStatus"] == "matched"

    def test_no_extractable_shot(self):
        """Test clip with no extractable shot name."""
        from src.function import conform_clips

        clips = [
            {"clip_name": "title_sequence_v001"}
        ]
        hierarchy_shots = {}

        result = conform_clips(clips, hierarchy_shots)

        assert result[0]["conformStatus"] == "unmatched"
        assert result[0]["extractedShotName"] is None
        assert result[0]["shotId"] is None


class TestFetchHierarchyShots:
    """Test hierarchy fetching from control-plane."""

    def test_fetch_simple_hierarchy(self):
        """Test fetching a simple hierarchy structure."""
        import sys
        from unittest.mock import MagicMock

        with patch.dict(sys.modules, {"requests": MagicMock()}):
            if "src.function" in sys.modules:
                del sys.modules["src.function"]
            from src.function import fetch_hierarchy_shots

            mock_requests = sys.modules["requests"]
            mock_resp = MagicMock()
            mock_resp.status_code = 200
            mock_resp.json.return_value = {
                "projects": [
                    {
                        "sequences": [
                            {
                                "shots": [
                                    {"id": "shot-1", "code": "SQ010_SH020"},
                                    {"id": "shot-2", "code": "SQ010_SH030"},
                                ]
                            }
                        ]
                    }
                ]
            }
            mock_requests.get.return_value = mock_resp

            result = fetch_hierarchy_shots("http://localhost:3000", "proj-123")

            assert "SQ010_SH020" in result
            assert "SQ010_SH030" in result
            assert result["SQ010_SH020"]["id"] == "shot-1"

    def test_fetch_hierarchy_with_children_fallback(self):
        """Test fetching when hierarchy uses 'children' instead of explicit keys."""
        import sys
        from unittest.mock import MagicMock

        with patch.dict(sys.modules, {"requests": MagicMock()}):
            if "src.function" in sys.modules:
                del sys.modules["src.function"]
            from src.function import fetch_hierarchy_shots

            mock_requests = sys.modules["requests"]
            mock_resp = MagicMock()
            mock_resp.status_code = 200
            mock_resp.json.return_value = {
                "projects": [
                    {
                        "children": [  # Fallback key for sequences
                            {
                                "children": [  # Fallback key for shots
                                    {"id": "shot-3", "code": "SQ020_SH010"},
                                    {"id": "shot-4", "code": "SQ020_SH020"},
                                ]
                            }
                        ]
                    }
                ]
            }
            mock_requests.get.return_value = mock_resp

            result = fetch_hierarchy_shots("http://localhost:3000", "proj-456")

            assert "SQ020_SH010" in result
            assert result["SQ020_SH010"]["id"] == "shot-3"

    def test_fetch_hierarchy_api_error(self):
        """Test handling of API errors."""
        import sys
        from unittest.mock import MagicMock

        with patch.dict(sys.modules, {"requests": MagicMock()}):
            if "src.function" in sys.modules:
                del sys.modules["src.function"]
            from src.function import fetch_hierarchy_shots

            mock_requests = sys.modules["requests"]
            mock_resp = MagicMock()
            mock_resp.status_code = 500
            mock_requests.get.return_value = mock_resp

            result = fetch_hierarchy_shots("http://localhost:3000", "proj-error")

            assert result == {}

    def test_fetch_hierarchy_network_error(self):
        """Test handling of network errors."""
        import sys
        from unittest.mock import MagicMock

        with patch.dict(sys.modules, {"requests": MagicMock()}):
            if "src.function" in sys.modules:
                del sys.modules["src.function"]
            from src.function import fetch_hierarchy_shots

            mock_requests = sys.modules["requests"]
            mock_requests.get.side_effect = ConnectionError("Network unreachable")

            result = fetch_hierarchy_shots("http://localhost:3000", "proj-network-fail")

            assert result == {}

    def test_fetch_hierarchy_malformed_response(self):
        """Test handling of malformed JSON response."""
        import sys
        from unittest.mock import MagicMock

        with patch.dict(sys.modules, {"requests": MagicMock()}):
            if "src.function" in sys.modules:
                del sys.modules["src.function"]
            from src.function import fetch_hierarchy_shots

            mock_requests = sys.modules["requests"]
            mock_resp = MagicMock()
            mock_resp.status_code = 200
            mock_resp.json.side_effect = ValueError("Invalid JSON")
            mock_requests.get.return_value = mock_resp

            result = fetch_hierarchy_shots("http://localhost:3000", "proj-bad-json")

            assert result == {}


class TestMain:
    """Test main function integration."""

    @patch.dict("os.environ", {
        "VAST_ASSET_ID": "asset-001",
        "OTIO_PARSE_RESULT": json.dumps({
            "clips": [
                {"clip_name": "SQ010_SH020_comp_v001"},
                {"clip_name": "SQ010_SH030_edit"},
            ]
        }),
        "VAST_PROJECT_ID": "proj-123",
        "CONTROL_PLANE_URL": "http://localhost:3000",
    })
    @patch("src.function.publish_completion")
    @patch("src.function.fetch_hierarchy_shots")
    def test_main_success(self, mock_fetch_hierarchy, mock_publish):
        """Test main function with valid inputs."""
        from src.function import main

        mock_fetch_hierarchy.return_value = {
            "SQ010_SH020": {"id": "shot-1"},
            "SQ010_SH030": {"id": "shot-2"},
        }

        result = main()

        assert result == 0
        mock_publish.assert_called_once()
        call_kwargs = mock_publish.call_args[1]
        assert call_kwargs["function_name"] == "timeline-conformer"
        assert call_kwargs["success"] is True
        assert call_kwargs["metadata"]["matched_clips"] == 2
        assert call_kwargs["metadata"]["total_clips"] == 2

    @patch.dict("os.environ", {})
    def test_main_missing_asset_id(self):
        """Test main when VAST_ASSET_ID is missing."""
        from src.function import main

        result = main()

        assert result == 1

    @patch.dict("os.environ", {
        "VAST_ASSET_ID": "asset-002",
    })
    def test_main_missing_otio_parse_result(self):
        """Test main when OTIO_PARSE_RESULT is missing."""
        from src.function import main

        result = main()

        assert result == 1

    @patch.dict("os.environ", {
        "VAST_ASSET_ID": "asset-003",
        "OTIO_PARSE_RESULT": "invalid json {",
    })
    def test_main_invalid_json(self):
        """Test main with malformed JSON."""
        from src.function import main

        result = main()

        assert result == 1

    @patch.dict("os.environ", {
        "VAST_ASSET_ID": "asset-004",
        "OTIO_PARSE_RESULT": json.dumps({
            "clips": [
                {"clip_name": "SQ010_SH020_comp"},
                {"clip_name": "unmatched_clip"},
            ]
        }),
        "CONTROL_PLANE_URL": "http://localhost:3000",
    })
    @patch("src.function.publish_completion")
    @patch("src.function.fetch_hierarchy_shots")
    def test_main_without_project_id(self, mock_fetch_hierarchy, mock_publish):
        """Test main when VAST_PROJECT_ID is not set."""
        from src.function import main

        mock_fetch_hierarchy.return_value = {}

        result = main()

        assert result == 0
        # Should still process clips (all unmatched)
        call_kwargs = mock_publish.call_args[1]
        assert call_kwargs["metadata"]["matched_clips"] == 0

    @patch.dict("os.environ", {
        "VAST_ASSET_ID": "asset-005",
        "OTIO_PARSE_RESULT": json.dumps({
            "tracks": [
                {
                    "clips": [
                        {"clip_name": "SQ010_SH020_comp"},
                        {"clip_name": "SQ010_SH030_comp"},
                    ]
                },
                {
                    "clips": [
                        {"clip_name": "SQ010_SH040_comp"},
                    ]
                },
            ]
        }),
        "VAST_PROJECT_ID": "proj-123",
        "CONTROL_PLANE_URL": "http://localhost:3000",
    })
    @patch("src.function.publish_completion")
    @patch("src.function.fetch_hierarchy_shots")
    def test_main_flattens_track_hierarchy(self, mock_fetch_hierarchy, mock_publish):
        """Test main flattens tracks structure correctly."""
        from src.function import main

        mock_fetch_hierarchy.return_value = {
            "SQ010_SH020": {"id": "shot-1"},
            "SQ010_SH030": {"id": "shot-2"},
            "SQ010_SH040": {"id": "shot-3"},
        }

        result = main()

        assert result == 0
        call_kwargs = mock_publish.call_args[1]
        assert call_kwargs["metadata"]["total_clips"] == 3
        assert call_kwargs["metadata"]["matched_clips"] == 3

    @patch.dict("os.environ", {
        "VAST_ASSET_ID": "asset-006",
        "OTIO_PARSE_RESULT": json.dumps({
            "clips": []
        }),
        "VAST_PROJECT_ID": "proj-123",
        "CONTROL_PLANE_URL": "http://localhost:3000",
    })
    @patch("src.function.publish_completion")
    @patch("src.function.fetch_hierarchy_shots")
    def test_main_empty_clips(self, mock_fetch_hierarchy, mock_publish):
        """Test main with empty clips list."""
        from src.function import main

        mock_fetch_hierarchy.return_value = {}

        result = main()

        assert result == 0
        call_kwargs = mock_publish.call_args[1]
        assert call_kwargs["metadata"]["total_clips"] == 0
        assert call_kwargs["metadata"]["matched_clips"] == 0

    @patch.dict("os.environ", {
        "VAST_ASSET_ID": "asset-007",
        "OTIO_PARSE_RESULT": json.dumps({
            "clips": [
                {"clip_name": "SQ010_SH020_comp"},
                {"clip_name": "SQ010_SH030_comp"},
                {"clip_name": "SQ010_SH040_comp"},
            ]
        }),
        "VAST_PROJECT_ID": "proj-123",
        "CONTROL_PLANE_URL": "http://localhost:3000",
    })
    @patch("src.function.publish_completion")
    @patch("src.function.fetch_hierarchy_shots")
    def test_main_partial_matches(self, mock_fetch_hierarchy, mock_publish):
        """Test main when only some clips match."""
        from src.function import main

        # Only provide 2 of 3 shots
        mock_fetch_hierarchy.return_value = {
            "SQ010_SH020": {"id": "shot-1"},
            "SQ010_SH030": {"id": "shot-2"},
        }

        result = main()

        assert result == 0
        call_kwargs = mock_publish.call_args[1]
        assert call_kwargs["metadata"]["total_clips"] == 3
        assert call_kwargs["metadata"]["matched_clips"] == 2
        assert call_kwargs["metadata"]["unmatched_clips"] == 1
