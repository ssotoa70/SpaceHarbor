"""
VAST DataEngine ScannerFunction entry point.

Called once per ElementCreated event when a render file lands in the VAST S3 view.
"""
import logging
import os
from typing import Any

from hierarchy_resolver import HierarchyNotFoundError, resolve_hierarchy
from ingest_client import DuplicateIngestError, IngestClient
from path_parser import parse_render_path
from trino_client import TrinoClient

logger = logging.getLogger(__name__)


def handler(event: dict, context: Any = None) -> dict:
    """
    VAST DataEngine entry point.
    Called once per ElementCreated event (one file = one invocation).
    """
    trino = TrinoClient(os.environ["VAST_TRINO_ENDPOINT"])
    ingest = IngestClient(
        os.environ["ASSETHARBOR_CONTROL_PLANE_URL"],
        api_key=os.environ.get("ASSETHARBOR_API_KEY"),
    )
    return handle_event(event, trino, ingest)


def handle_event(event: dict, trino_client: Any, ingest_client: Any) -> dict:
    """
    Core logic — separated from handler() for testability.
    Accepts injected trino_client and ingest_client.
    """
    record = event["Records"][0]
    key    = record["s3"]["object"]["key"]
    etag   = record["s3"]["object"].get("eTag", "")
    size   = record["s3"]["object"].get("size", 0)
    bucket = record["s3"]["bucket"]["name"]

    logger.info("ScannerFunction triggered: %s", key)

    parsed = parse_render_path(key)
    if parsed is None:
        logger.info("Skipping non-render path: %s", key)
        return {"status": "skipped", "reason": "not a render path"}

    try:
        resolved = resolve_hierarchy(parsed, trino_client)
    except HierarchyNotFoundError as e:
        logger.error("Hierarchy not found for %s: %s", key, e)
        raise

    try:
        result = ingest_client.ingest_file(
            source_uri=f"s3://{bucket}/{key}",
            title=parsed["filename"],
            shot_id=resolved["shot_id"],
            project_id=resolved["project_id"],
            version_label=parsed["version_label"],
            file_size=size,
            md5_checksum=etag,
            created_by=record.get("userIdentity", {}).get("principalId", "scanner"),
        )
    except DuplicateIngestError:
        logger.info("Duplicate event — already ingested: %s", key)
        return {"status": "already_ingested", "key": key}

    logger.info("Ingested: asset_id=%s", result["asset"]["id"])
    return {"status": "ingested", "asset_id": result["asset"]["id"]}
