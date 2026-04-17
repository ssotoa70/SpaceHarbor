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


# ---------------------------------------------------------------------------
# Endpoint tests for /api/v1/metadata/lookup
# ---------------------------------------------------------------------------

from unittest.mock import MagicMock
from contextlib import contextmanager

from fastapi.testclient import TestClient

import main as app_module
from main import app

client = TestClient(app)


def _stub_session(rows: list[dict], columns: list[str]):
    """Return a MagicMock that mimics the minimal vastdb session surface
    the endpoint uses: bucket(...).schema(...).table(...).select(...)."""
    table = MagicMock()
    table.columns = [MagicMock(name=c) for c in columns]
    for col, mock in zip(columns, table.columns):
        mock.name = col
    table.select.return_value.read_all.return_value.to_pylist.return_value = rows
    schema_obj = MagicMock()
    schema_obj.table.return_value = table
    bucket_obj = MagicMock()
    bucket_obj.schema.return_value = schema_obj
    tx = MagicMock()
    tx.bucket.return_value = bucket_obj
    return tx, table


@contextmanager
def _ctx(tx):
    """Helper context-manager wrapper for the mocked vast_transaction."""
    yield tx


class TestMetadataLookupEndpoint:
    def test_returns_matched_rows(self, monkeypatch):
        tx, table = _stub_session(
            rows=[{"source_uri": "uploads/pixar_5603.exr", "width": 2048, "height": 858}],
            columns=["source_uri", "width", "height"],
        )
        monkeypatch.setattr(app_module, "vast_transaction",
                            lambda bucket=None: _ctx(tx))
        r = client.get(
            "/api/v1/metadata/lookup",
            params={"path": "uploads/pixar_5603.exr",
                    "schema": "frame_metadata", "table": "files"},
        )
        assert r.status_code == 200
        body = r.json()
        assert body["count"] == 1
        assert body["schema"] == "frame_metadata"
        assert body["table"] == "files"
        assert body["matched_by"] == "source_uri"
        assert body["rows"][0]["width"] == 2048

    def test_strips_s3_scheme_and_bucket_prefix(self, monkeypatch):
        tx, table = _stub_session(rows=[], columns=["source_uri"])
        monkeypatch.setattr(app_module, "vast_transaction",
                            lambda bucket=None: _ctx(tx))
        client.get(
            "/api/v1/metadata/lookup",
            params={"path": "s3://sergio-spaceharbor/uploads/pixar_5603.exr",
                    "schema": "frame_metadata", "table": "files"},
        )
        # Assert the select predicate received just the key, not the full URI.
        call = table.select.call_args
        # The predicate is the first positional arg; its string form includes
        # the key but not the s3:// prefix.
        assert "uploads/pixar_5603.exr" in str(call)
        assert "s3://" not in str(call)

    def test_400_when_no_priority_column_in_target_table(self, monkeypatch):
        tx, table = _stub_session(rows=[], columns=["width", "height"])
        monkeypatch.setattr(app_module, "vast_transaction",
                            lambda bucket=None: _ctx(tx))
        r = client.get(
            "/api/v1/metadata/lookup",
            params={"path": "k", "schema": "x", "table": "y"},
        )
        assert r.status_code == 400
        detail = r.json()["detail"]
        assert "width" in detail and "height" in detail
        assert "source_uri" in detail  # expected priority column named

    def test_503_when_sdk_raises(self, monkeypatch):
        class Boom(Exception):
            pass

        def _raise(*_a, **_kw):
            raise Boom("bucket not found")

        monkeypatch.setattr(app_module, "vast_transaction", _raise)
        r = client.get(
            "/api/v1/metadata/lookup",
            params={"path": "k", "schema": "x", "table": "y"},
        )
        assert r.status_code == 503
        assert "bucket not found" in r.json()["detail"]

    def test_required_params(self):
        r = client.get("/api/v1/metadata/lookup", params={"schema": "x", "table": "y"})
        assert r.status_code == 422  # fastapi validation — missing path
        r = client.get("/api/v1/metadata/lookup", params={"path": "k", "table": "y"})
        assert r.status_code == 422  # missing schema
