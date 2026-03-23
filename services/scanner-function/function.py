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


def handler(ctx: Any, event: dict) -> dict:
    """
    VAST DataEngine entry point.
    Called as handler(ctx, event) per DataEngine spec.
    ctx: DataEngine execution context.
    event: S3 ElementCreated event (one file = one invocation).
    """
    trino = TrinoClient(
        os.environ["VAST_TRINO_ENDPOINT"],
        username=os.environ.get("VAST_TRINO_USERNAME"),
        password=os.environ.get("VAST_TRINO_PASSWORD"),
    )
    ingest = IngestClient(
        os.environ["SPACEHARBOR_CONTROL_PLANE_URL"],
        api_key=os.environ.get("SPACEHARBOR_API_KEY"),
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

    # Sentinel (.ready) file: represents a completed render sequence.
    # Ingest the whole sequence directory as a single asset rather than
    # ingesting the zero-byte sentinel file itself.
    if parsed.get("is_sentinel"):
        logger.info(
            "Sentinel trigger detected (%s) — ingesting render sequence directory: %s",
            key,
            parsed["filename"],
        )
        source_uri = f"s3://{bucket}/{parsed['filename']}"
        # Derive a human-readable title from the last two path components:
        # e.g. "projects/PROJ/SEQ/SHOT/render/v001" -> "SHOT/v001"
        parts = parsed["filename"].rstrip("/").split("/")
        title = "/".join(parts[-2:]) if len(parts) >= 2 else parts[-1]
        # Sentinel events carry no meaningful file size or checksum.
        ingest_size = 0
        ingest_etag = ""
    else:
        source_uri = f"s3://{bucket}/{key}"
        title = parsed["filename"]
        ingest_size = size
        ingest_etag = etag

    try:
        resolved = resolve_hierarchy(parsed, trino_client)
    except HierarchyNotFoundError as e:
        logger.error("Hierarchy not found for %s: %s", key, e)
        raise

    try:
        result = ingest_client.ingest_file(
            source_uri=source_uri,
            title=title,
            shot_id=resolved["shot_id"],
            project_id=resolved["project_id"],
            version_label=parsed["version_label"],
            file_size=ingest_size,
            md5_checksum=ingest_etag,
            created_by=record.get("userIdentity", {}).get("principalId", "scanner"),
        )
    except DuplicateIngestError:
        logger.info("Duplicate event — already ingested: %s", key)
        return {"status": "already_ingested", "key": key}

    logger.info("Ingested: asset_id=%s", result["asset"]["id"])
    return {"status": "ingested", "asset_id": result["asset"]["id"]}
