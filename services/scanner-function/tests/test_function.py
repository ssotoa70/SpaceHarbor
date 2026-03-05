import pytest
import sys
import os
from unittest.mock import MagicMock, patch

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

from hierarchy_resolver import HierarchyNotFoundError


def make_s3_event(key: str, etag: str = "abc123", size: int = 104857600) -> dict:
    return {
        "Records": [
            {
                "s3": {
                    "bucket": {"name": "assetharbor-renders"},
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
