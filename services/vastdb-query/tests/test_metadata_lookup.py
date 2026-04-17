"""Tests for /api/v1/metadata/lookup — schema-agnostic per-asset VAST DB reader."""
import pytest

from main import resolve_match_column, MATCH_COLUMN_PRIORITY


class TestResolveMatchColumn:
    def test_picks_first_priority_when_present(self):
        cols = ["width", "source_uri", "height", "file_path"]
        assert resolve_match_column(cols) == "source_uri"

    def test_falls_through_priority_when_earlier_missing(self):
        cols = ["width", "file_path", "height"]
        assert resolve_match_column(cols) == "file_path"

    def test_matches_case_insensitively(self):
        cols = ["Width", "SOURCE_URI", "Height"]
        assert resolve_match_column(cols) == "SOURCE_URI"

    def test_returns_none_when_no_priority_column_present(self):
        cols = ["width", "height", "duration"]
        assert resolve_match_column(cols) is None

    def test_returns_none_on_empty_list(self):
        assert resolve_match_column([]) is None

    def test_priority_list_is_stable(self):
        # Contract: `source_uri` first, then `s3_key`, `path`, `file_path`, `uri`.
        assert MATCH_COLUMN_PRIORITY == ("source_uri", "s3_key", "path", "file_path", "uri")
