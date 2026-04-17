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


def _stub_bucket():
    """Return a Bucket mock where `bkt.schema(name).table(name)` returns
    a Table mock. The endpoint no longer introspects columns from the
    Table (vastdb SDK's Table.columns is a method, not iterable), so
    this helper only cares about the chain shape, not column names —
    columns are derived from the first row's keys at the caller."""
    table = MagicMock()
    schema_obj = MagicMock()
    schema_obj.table.return_value = table
    bkt = MagicMock()
    bkt.schema.return_value = schema_obj
    return bkt, table


@contextmanager
def _ctx(bkt):
    """Helper context-manager wrapper for the mocked vast_transaction."""
    yield bkt


class TestMetadataLookupEndpoint:
    def test_returns_matched_rows(self, monkeypatch):
        bkt, _table = _stub_bucket()
        all_rows = [
            {"source_uri": "uploads/pixar_5603.exr", "width": 2048, "height": 858},
            {"source_uri": "uploads/other.exr", "width": 1920, "height": 1080},
        ]
        monkeypatch.setattr(app_module, "vast_transaction",
                            lambda bucket=None: _ctx(bkt))
        monkeypatch.setattr(app_module, "table_to_records",
                            lambda table_obj, limit=10000, columns=None: all_rows)
        r = client.get(
            "/api/v1/metadata/lookup",
            params={"path": "uploads/pixar_5603.exr",
                    "schema": "frame_metadata", "table": "files"},
        )
        assert r.status_code == 200, r.text
        body = r.json()
        assert body["count"] == 1  # Python-side filter selected 1 of 2
        assert body["schema"] == "frame_metadata"
        assert body["table"] == "files"
        assert body["matched_by"] == "source_uri"
        assert body["rows"][0]["width"] == 2048
        assert body["rows"][0]["source_uri"] == "uploads/pixar_5603.exr"

    def test_strips_only_s3_scheme_preserves_bucket(self, monkeypatch):
        # Live frame_metadata.files stores file_path as `bucket/key` (no
        # scheme), verified on 10.143.2.102. The endpoint strips ONLY the
        # `s3://` scheme so `s3://bucket/key` matches rows keyed `bucket/key`.
        bkt, _table = _stub_bucket()
        all_rows = [{"file_path": "sergio-spaceharbor/uploads/pixar_5603.exr"}]
        monkeypatch.setattr(app_module, "vast_transaction",
                            lambda bucket=None: _ctx(bkt))
        monkeypatch.setattr(app_module, "table_to_records",
                            lambda table_obj, limit=10000, columns=None: all_rows)
        r = client.get(
            "/api/v1/metadata/lookup",
            params={"path": "s3://sergio-spaceharbor/uploads/pixar_5603.exr",
                    "schema": "frame_metadata", "table": "files"},
        )
        assert r.status_code == 200
        assert r.json()["count"] == 1
        assert r.json()["matched_by"] == "file_path"

    def test_bare_bucket_key_path_also_matches(self, monkeypatch):
        # Callers can pass the bare `bucket/key` form too — the endpoint
        # does not add or remove the bucket. Bare keys without a bucket
        # prefix will only match if the extractor stored them that way.
        bkt, _table = _stub_bucket()
        all_rows = [{"file_path": "sergio-spaceharbor/uploads/pixar_5603.exr"}]
        monkeypatch.setattr(app_module, "vast_transaction",
                            lambda bucket=None: _ctx(bkt))
        monkeypatch.setattr(app_module, "table_to_records",
                            lambda table_obj, limit=10000, columns=None: all_rows)
        r = client.get(
            "/api/v1/metadata/lookup",
            params={"path": "sergio-spaceharbor/uploads/pixar_5603.exr",
                    "schema": "frame_metadata", "table": "files"},
        )
        assert r.status_code == 200
        assert r.json()["count"] == 1

    def test_400_when_no_priority_column_in_target_table(self, monkeypatch):
        # Column names are now derived from the first row's dict keys, so
        # to trigger the 400 the table must return at least one row whose
        # keys are ALL non-priority names.
        bkt, _table = _stub_bucket()
        monkeypatch.setattr(app_module, "vast_transaction",
                            lambda bucket=None: _ctx(bkt))
        monkeypatch.setattr(app_module, "table_to_records",
                            lambda table_obj, limit=10000, columns=None: [
                                {"width": 100, "height": 200},
                            ])
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

    def test_empty_table_returns_zero_count(self, monkeypatch):
        # Covers the case where the table exists, has the match column,
        # but contains no rows — the response should be 200 with count=0.
        bkt, _table = _stub_bucket()
        monkeypatch.setattr(app_module, "vast_transaction",
                            lambda bucket=None: _ctx(bkt))
        monkeypatch.setattr(app_module, "table_to_records",
                            lambda table_obj, limit=10000, columns=None: [])
        r = client.get(
            "/api/v1/metadata/lookup",
            params={"path": "uploads/nothing.exr", "schema": "x", "table": "y"},
        )
        assert r.status_code == 200
        assert r.json()["count"] == 0
        assert r.json()["rows"] == []
