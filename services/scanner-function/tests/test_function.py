import pytest
import sys
import os
from unittest.mock import MagicMock, patch, PropertyMock

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

from hierarchy_resolver import HierarchyNotFoundError


def make_s3_event(key: str, etag: str = "abc123", size: int = 104857600) -> dict:
    return {
        "Records": [
            {
                "s3": {
                    "bucket": {"name": "spaceharbor-renders"},
                    "object": {"key": key, "eTag": etag, "size": size},
                },
                "userIdentity": {"principalId": "scanner"},
            }
        ]
    }


def make_mock_trino(project_id="proj-uuid", sequence_id="seq-uuid", shot_id="shot-uuid"):
    mock = MagicMock()

    def query_side_effect(sql, params):
        if "projects" in sql:
            return [{"id": project_id}]
        if "sequences" in sql:
            return [{"id": sequence_id}]
        if "shots" in sql:
            return [{"id": shot_id}]
        return []

    mock.query.side_effect = query_side_effect
    return mock


def make_mock_ingest(asset_id="asset-uuid"):
    mock = MagicMock()
    mock.ingest_file.return_value = {"asset": {"id": asset_id}}
    return mock


def test_full_event_creates_version():
    from function import handle_event

    mock_trino = make_mock_trino()
    mock_ingest = make_mock_ingest()

    event = make_s3_event(
        key="projects/NOVA/SEQ_010/SH040/render/v001/beauty.0001.exr",
        etag="abc123",
        size=104857600,
    )
    result = handle_event(event, mock_trino, mock_ingest)
    assert result["status"] == "ingested"
    assert result["asset_id"] == "asset-uuid"
    mock_ingest.ingest_file.assert_called_once()
    call_kwargs = mock_ingest.ingest_file.call_args[1]
    assert call_kwargs["shot_id"] == "shot-uuid"


def test_unknown_project_code_raises_error():
    from function import handle_event

    mock_trino = MagicMock()
    mock_trino.query.return_value = []  # empty — project not found

    mock_ingest = MagicMock()

    event = make_s3_event(key="projects/UNKNOWN_PROJ/SEQ/SHOT/render/v001/f.exr")
    with pytest.raises(HierarchyNotFoundError):
        handle_event(event, mock_trino, mock_ingest)


def test_duplicate_event_is_idempotent():
    from function import handle_event
    from ingest_client import DuplicateIngestError

    mock_trino = make_mock_trino()

    call_count = {"n": 0}

    def ingest_side_effect(**kwargs):
        call_count["n"] += 1
        if call_count["n"] == 1:
            return {"asset": {"id": "asset-uuid"}}
        raise DuplicateIngestError("already ingested")

    mock_ingest = MagicMock()
    mock_ingest.ingest_file.side_effect = ingest_side_effect

    event = make_s3_event(key="projects/NOVA/SEQ_010/SH040/render/v001/beauty.0001.exr")

    result = handle_event(event, mock_trino, mock_ingest)
    assert result["status"] == "ingested"
    assert call_count["n"] == 1

    # second call with same event — ingest_client raises DuplicateIngestError → function returns already_ingested
    result2 = handle_event(event, mock_trino, mock_ingest)
    assert result2["status"] == "already_ingested"
    assert call_count["n"] == 2


def test_ready_sentinel_ingests_sequence_as_single_asset():
    """A .ready sentinel event must create exactly one asset for the render sequence directory."""
    from function import handle_event

    mock_trino = make_mock_trino()
    mock_ingest = make_mock_ingest(asset_id="seq-asset-uuid")

    event = make_s3_event(
        key="projects/NOVA/SEQ_010/SH040/render/v001/beauty_v001.ready",
        etag="",
        size=0,
    )
    result = handle_event(event, mock_trino, mock_ingest)
    assert result["status"] == "ingested"
    assert result["asset_id"] == "seq-asset-uuid"
    # Must be called exactly once — not once per frame
    mock_ingest.ingest_file.assert_called_once()


def test_ready_sentinel_uses_directory_as_source_uri():
    """The source_uri for a sentinel ingest must point to the render directory, not the .ready file."""
    from function import handle_event

    mock_trino = make_mock_trino()
    mock_ingest = make_mock_ingest()

    event = make_s3_event(
        key="projects/NOVA/SEQ_010/SH040/render/v001/beauty_v001.ready",
        etag="",
        size=0,
    )
    handle_event(event, mock_trino, mock_ingest)
    call_kwargs = mock_ingest.ingest_file.call_args[1]
    source_uri = call_kwargs["source_uri"]
    assert source_uri.startswith("s3://")
    assert source_uri.endswith("render/v001")
    assert ".ready" not in source_uri


def test_ready_sentinel_title_is_human_readable():
    """The asset title for a sentinel ingest must be derived from the sequence directory, not the .ready filename."""
    from function import handle_event

    mock_trino = make_mock_trino()
    mock_ingest = make_mock_ingest()

    event = make_s3_event(
        key="projects/NOVA/SEQ_010/SH040/render/v001/beauty_v001.ready",
        etag="",
        size=0,
    )
    handle_event(event, mock_trino, mock_ingest)
    call_kwargs = mock_ingest.ingest_file.call_args[1]
    title = call_kwargs["title"]
    # Title should reflect the render version context, not the trigger filename
    assert ".ready" not in title
    assert "v001" in title


def test_regular_single_file_still_works_after_sentinel_support():
    """Standard single-file events must continue to work unchanged after sentinel handling is added."""
    from function import handle_event

    mock_trino = make_mock_trino()
    mock_ingest = make_mock_ingest(asset_id="single-asset-uuid")

    event = make_s3_event(
        key="projects/NOVA/SEQ_010/SH040/render/v002/beauty.0042.exr",
        etag="deadbeef",
        size=52428800,
    )
    result = handle_event(event, mock_trino, mock_ingest)
    assert result["status"] == "ingested"
    assert result["asset_id"] == "single-asset-uuid"
    call_kwargs = mock_ingest.ingest_file.call_args[1]
    assert call_kwargs["source_uri"].endswith("beauty.0042.exr")
    assert call_kwargs["title"] == "beauty.0042.exr"
    assert call_kwargs["file_size"] == 52428800


def test_handler_signature_matches_vast_dataengine_spec():
    """VAST DataEngine calls handler(ctx, event) — verify parameter order."""
    import inspect
    from function import handler
    sig = inspect.signature(handler)
    params = list(sig.parameters.keys())
    assert params[0] == "ctx", f"First param should be 'ctx', got '{params[0]}'"
    assert params[1] == "event", f"Second param should be 'event', got '{params[1]}'"


# --- TrinoClient tests (official driver) ---

def test_trino_client_rejects_invalid_endpoint():
    """TrinoClient should reject malformed endpoint URLs."""
    from trino_client import TrinoClient
    with pytest.raises(ValueError, match="Invalid Trino endpoint URL"):
        TrinoClient("")


def test_trino_client_parses_endpoint_host_port():
    """TrinoClient should correctly parse host and port from endpoint URL."""
    from trino_client import TrinoClient
    client = TrinoClient("http://trino-server:9090")
    assert client._host == "trino-server"
    assert client._port == 9090
    assert client._http_scheme == "http"


def test_trino_client_default_port_http():
    """TrinoClient should default to port 8080 for HTTP."""
    from trino_client import TrinoClient
    client = TrinoClient("http://trino-server")
    assert client._port == 8080


def test_trino_client_default_port_https():
    """TrinoClient should default to port 443 for HTTPS."""
    from trino_client import TrinoClient
    client = TrinoClient("https://trino-server")
    assert client._port == 443


def test_trino_client_stores_credentials():
    """TrinoClient should store username/password for auth."""
    from trino_client import TrinoClient
    client = TrinoClient(
        "http://localhost:8080",
        username="admin",
        password="secret",
    )
    assert client._username == "admin"
    assert client._password == "secret"


def test_trino_client_falls_back_to_user_for_username():
    """TrinoClient should use 'user' parameter as username when username not provided."""
    from trino_client import TrinoClient
    client = TrinoClient("http://localhost:8080", user="my_user")
    assert client._username == "my_user"
    assert client._password is None


def test_trino_client_query_uses_parameterized_queries():
    """TrinoClient.query() should use DBAPI parameterized queries, not string interpolation."""
    from trino_client import TrinoClient

    client = TrinoClient("http://localhost:8080")

    mock_cursor = MagicMock()
    mock_cursor.description = [("id",), ("name",)]
    mock_cursor.fetchall.return_value = [("uuid-1", "NOVA")]

    mock_conn = MagicMock()
    mock_conn.cursor.return_value = mock_cursor

    with patch.object(client, "_get_connection", return_value=mock_conn):
        result = client.query(
            "SELECT id, name FROM projects WHERE code = ?",
            ["NOVA"],
        )

    # Verify parameterized execution (no string interpolation)
    mock_cursor.execute.assert_called_once_with(
        "SELECT id, name FROM projects WHERE code = ?",
        ["NOVA"],
    )
    assert result == [{"id": "uuid-1", "name": "NOVA"}]
    mock_conn.close.assert_called_once()


def test_trino_client_query_without_params():
    """TrinoClient.query() should work without parameters."""
    from trino_client import TrinoClient

    client = TrinoClient("http://localhost:8080")

    mock_cursor = MagicMock()
    mock_cursor.description = [("count",)]
    mock_cursor.fetchall.return_value = [(42,)]

    mock_conn = MagicMock()
    mock_conn.cursor.return_value = mock_cursor

    with patch.object(client, "_get_connection", return_value=mock_conn):
        result = client.query("SELECT count(*) AS count FROM projects")

    mock_cursor.execute.assert_called_once_with(
        "SELECT count(*) AS count FROM projects",
        None,
    )
    assert result == [{"count": 42}]


def test_trino_client_execute_uses_parameterized_queries():
    """TrinoClient.execute() should use DBAPI parameterized queries."""
    from trino_client import TrinoClient

    client = TrinoClient("http://localhost:8080")

    mock_cursor = MagicMock()
    mock_cursor.fetchall.return_value = []

    mock_conn = MagicMock()
    mock_conn.cursor.return_value = mock_cursor

    with patch.object(client, "_get_connection", return_value=mock_conn):
        client.execute(
            "INSERT INTO sequences (id, project_id, code) VALUES (?, ?, ?)",
            ["new-id", "proj-id", "SEQ_010"],
        )

    mock_cursor.execute.assert_called_once_with(
        "INSERT INTO sequences (id, project_id, code) VALUES (?, ?, ?)",
        ["new-id", "proj-id", "SEQ_010"],
    )
    mock_conn.close.assert_called_once()


def test_trino_client_connection_always_closed():
    """TrinoClient should always close the connection even on error."""
    from trino_client import TrinoClient

    client = TrinoClient("http://localhost:8080")

    mock_cursor = MagicMock()
    mock_cursor.execute.side_effect = RuntimeError("query failed")

    mock_conn = MagicMock()
    mock_conn.cursor.return_value = mock_cursor

    with patch.object(client, "_get_connection", return_value=mock_conn):
        with pytest.raises(RuntimeError, match="query failed"):
            client.query("SELECT * FROM bad_table")

    # Connection should still be closed
    mock_conn.close.assert_called_once()


def test_trino_client_get_connection_with_auth():
    """TrinoClient._get_connection() should use BasicAuthentication when password is set."""
    from trino_client import TrinoClient

    client = TrinoClient(
        "http://trino:8080",
        username="admin",
        password="secret123",
    )

    with patch("trino.dbapi.connect") as mock_connect:
        client._get_connection()
        mock_connect.assert_called_once()
        call_kwargs = mock_connect.call_args[1]
        assert call_kwargs["host"] == "trino"
        assert call_kwargs["port"] == 8080
        assert call_kwargs["user"] == "admin"
        assert call_kwargs["catalog"] == "vast"
        assert call_kwargs["schema"] == "spaceharbor"
        assert isinstance(call_kwargs["auth"], trino.auth.BasicAuthentication)


def test_trino_client_get_connection_without_auth():
    """TrinoClient._get_connection() should not set auth when no password is provided."""
    from trino_client import TrinoClient

    client = TrinoClient("http://trino:8080", user="scanner")

    with patch("trino.dbapi.connect") as mock_connect:
        client._get_connection()
        call_kwargs = mock_connect.call_args[1]
        assert "auth" not in call_kwargs
        assert call_kwargs["user"] == "scanner"


# --- SQL identifier validation tests (preserved from original) ---

def test_validate_identifier_accepts_valid_names():
    from trino_client import validate_identifier
    assert validate_identifier("projects") == "projects"
    assert validate_identifier("my_table_123") == "my_table_123"
    assert validate_identifier("A") == "A"


def test_validate_identifier_rejects_empty():
    from trino_client import validate_identifier
    with pytest.raises(ValueError, match="must not be empty"):
        validate_identifier("")


def test_validate_identifier_rejects_too_long():
    from trino_client import validate_identifier
    with pytest.raises(ValueError, match="too long"):
        validate_identifier("a" * 129)


def test_validate_identifier_rejects_special_chars():
    from trino_client import validate_identifier
    with pytest.raises(ValueError, match="unsafe characters"):
        validate_identifier("table; DROP TABLE --")
    with pytest.raises(ValueError, match="unsafe characters"):
        validate_identifier("name'injection")
    with pytest.raises(ValueError, match="unsafe characters"):
        validate_identifier("schema.table")


# --- SQL injection prevention via parameterized queries ---

def test_sql_injection_prevented_by_parameterization():
    """Parameterized queries prevent SQL injection by design — params are never interpolated."""
    from trino_client import TrinoClient

    client = TrinoClient("http://localhost:8080")

    mock_cursor = MagicMock()
    mock_cursor.description = [("id",)]
    mock_cursor.fetchall.return_value = []

    mock_conn = MagicMock()
    mock_conn.cursor.return_value = mock_cursor

    malicious_input = "'; DROP TABLE sequences; --"

    with patch.object(client, "_get_connection", return_value=mock_conn):
        result = client.query(
            "SELECT id FROM projects WHERE code = ?",
            [malicious_input],
        )

    # The malicious input is passed as a parameter, not interpolated into SQL.
    # The driver sends it safely to Trino as a bound parameter value.
    mock_cursor.execute.assert_called_once_with(
        "SELECT id FROM projects WHERE code = ?",
        [malicious_input],
    )
    # No rows returned — the injection attempt is treated as a literal string
    assert result == []


import trino
