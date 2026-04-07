"""
SpaceHarbor VAST Database Query Service.

Lightweight REST API that queries VAST Database tables using the vastdb
Python SDK. Designed to read tables created by DataEngine serverless
functions (e.g. exr-inspector) without requiring Trino.

Environment variables:
  VASTDB_ENDPOINT    - CNode VIP or S3 endpoint (required)
  VASTDB_ACCESS_KEY  - S3 access key (required)
  VASTDB_SECRET_KEY  - S3 secret key (required)
  VASTDB_BUCKET      - Database bucket (default: sergio-db)
  VASTDB_SCHEMA      - Schema name (default: exr_metadata_2)
  PORT               - HTTP port (default: 8070)
"""

import logging
import os
from contextlib import contextmanager
from typing import Optional

import pyarrow as pa
import vastdb
from fastapi import FastAPI, HTTPException, Query
from fastapi.middleware.cors import CORSMiddleware

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger("vastdb-query")

# ---------------------------------------------------------------------------
# Configuration
# ---------------------------------------------------------------------------

ENDPOINT = os.environ.get("VASTDB_ENDPOINT", "")
ACCESS_KEY = os.environ.get("VASTDB_ACCESS_KEY", "")
SECRET_KEY = os.environ.get("VASTDB_SECRET_KEY", "")
DEFAULT_BUCKET = os.environ.get("VASTDB_BUCKET", "sergio-db")
DEFAULT_SCHEMA = os.environ.get("VASTDB_SCHEMA", "exr_metadata_2")

app = FastAPI(
    title="SpaceHarbor VAST DB Query",
    description="Query VAST Database tables created by DataEngine functions",
    version="1.0.0",
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["GET"],
    allow_headers=["*"],
)

# ---------------------------------------------------------------------------
# VAST DB helpers
# ---------------------------------------------------------------------------

@contextmanager
def vast_transaction(bucket: str = DEFAULT_BUCKET):
    """Open a vastdb read transaction."""
    if not ENDPOINT:
        raise HTTPException(503, detail="VASTDB_ENDPOINT not configured")
    session = vastdb.connect(endpoint=ENDPOINT, access=ACCESS_KEY, secret=SECRET_KEY)
    with session.transaction() as tx:
        yield tx.bucket(bucket)


def table_to_records(
    table,
    columns: Optional[list[str]] = None,
    predicate: Optional[pa.compute.Expression] = None,
    limit: int = 100,
) -> list[dict]:
    """Read a VAST table and return as list of dicts."""
    kwargs = {}
    if columns:
        kwargs["columns"] = columns
    if predicate is not None:
        kwargs["predicate"] = predicate

    reader = table.select(**kwargs)
    arrow_table = reader.read_all()

    # Apply limit
    if len(arrow_table) > limit:
        arrow_table = arrow_table.slice(0, limit)

    return arrow_table.to_pylist()


# ---------------------------------------------------------------------------
# Columns to exclude (vector columns break some readers)
# ---------------------------------------------------------------------------

FILES_COLUMNS = [
    "file_id", "file_path", "file_path_normalized", "header_hash",
    "size_bytes", "mtime", "multipart_count", "is_deep",
    "frame_number", "inspection_timestamp", "inspection_count", "last_inspected",
]

CHANNELS_COLUMNS = [
    "file_id", "file_path", "part_index", "channel_name",
    "layer_name", "component_name", "channel_type",
    "x_sampling", "y_sampling",
]

# ---------------------------------------------------------------------------
# Routes
# ---------------------------------------------------------------------------

@app.get("/health")
def health():
    return {
        "status": "ok",
        "service": "vastdb-query",
        "endpoint": ENDPOINT or "not configured",
        "bucket": DEFAULT_BUCKET,
        "schema": DEFAULT_SCHEMA,
    }


@app.get("/api/v1/exr-metadata/stats")
def exr_stats(
    bucket: str = Query(DEFAULT_BUCKET),
    schema: str = Query(DEFAULT_SCHEMA),
):
    """Get summary counts from exr-inspector tables."""
    try:
        with vast_transaction(bucket) as bkt:
            s = bkt.schema(schema)
            files_count = len(s.table("files").select(columns=["file_id"]).read_all())
            parts_count = len(s.table("parts").select(columns=["file_id"]).read_all())
            channels_count = len(s.table("channels").select(columns=["file_id"]).read_all())
            attrs_count = len(s.table("attributes").select(columns=["file_id"]).read_all())

        return {
            "totalFiles": files_count,
            "totalParts": parts_count,
            "totalChannels": channels_count,
            "totalAttributes": attrs_count,
            "schema": f"{bucket}/{schema}",
        }
    except HTTPException:
        raise
    except Exception as e:
        logger.exception("stats query failed")
        raise HTTPException(503, detail=str(e))


@app.get("/api/v1/exr-metadata/files")
def exr_files(
    bucket: str = Query(DEFAULT_BUCKET),
    schema: str = Query(DEFAULT_SCHEMA),
    pathPrefix: Optional[str] = Query(None),
    limit: int = Query(50, ge=1, le=500),
    offset: int = Query(0, ge=0),
):
    """List EXR files with metadata."""
    try:
        with vast_transaction(bucket) as bkt:
            tbl = bkt.schema(schema).table("files")

            predicate = None
            if pathPrefix:
                predicate = pa.compute.field("file_path").cast(pa.utf8()).starts_with(pathPrefix)

            records = table_to_records(tbl, columns=FILES_COLUMNS, predicate=predicate, limit=limit + offset)

        # Manual offset/limit (vastdb SDK doesn't support offset natively)
        paged = records[offset:offset + limit]
        return {"files": paged, "total": len(records), "schema": f"{bucket}/{schema}"}
    except HTTPException:
        raise
    except Exception as e:
        logger.exception("files query failed")
        raise HTTPException(503, detail=str(e))


@app.get("/api/v1/exr-metadata/files/{file_id}")
def exr_file_detail(
    file_id: str,
    bucket: str = Query(DEFAULT_BUCKET),
    schema: str = Query(DEFAULT_SCHEMA),
):
    """Get full detail for one EXR file: parts, channels, attributes."""
    try:
        with vast_transaction(bucket) as bkt:
            s = bkt.schema(schema)
            pred = pa.compute.field("file_id") == file_id

            files = table_to_records(s.table("files"), columns=FILES_COLUMNS, predicate=pred, limit=1)
            if not files:
                raise HTTPException(404, detail=f"File not found: {file_id}")

            parts = table_to_records(s.table("parts"), predicate=pred, limit=100)
            channels = table_to_records(s.table("channels"), columns=CHANNELS_COLUMNS, predicate=pred, limit=500)
            attributes = table_to_records(s.table("attributes"), predicate=pred, limit=1000)

        return {
            "file": files[0],
            "parts": parts,
            "channels": channels,
            "attributes": attributes,
        }
    except HTTPException:
        raise
    except Exception as e:
        logger.exception("file detail query failed")
        raise HTTPException(503, detail=str(e))


@app.get("/api/v1/exr-metadata/lookup")
def exr_lookup(
    path: str = Query(..., description="File path or S3 URI to look up"),
    bucket: str = Query(DEFAULT_BUCKET),
    schema: str = Query(DEFAULT_SCHEMA),
):
    """Look up EXR metadata by file path. Correlates SpaceHarbor assets with exr-inspector data."""
    # Normalize path: strip s3://bucket/ prefix
    normalized = path
    for prefix in ("s3://", "vast://"):
        if normalized.startswith(prefix):
            normalized = "/" + normalized.split("/", 3)[-1] if normalized.count("/") >= 3 else normalized

    try:
        with vast_transaction(bucket) as bkt:
            s = bkt.schema(schema)
            parts_tbl = s.table("parts")

            # Try to find by file_path on parts table (no vector columns)
            all_parts = table_to_records(parts_tbl, limit=10000)

            # Search for matching file — try exact path, normalized, and filename
            filename = path.rsplit("/", 1)[-1] if "/" in path else path
            matched_file_id = None
            for p in all_parts:
                fp = str(p.get("file_path", ""))
                fp_name = fp.rsplit("/", 1)[-1] if "/" in fp else fp
                if fp == normalized or fp == path or fp_name == filename:
                    matched_file_id = p.get("file_id")
                    break

            if not matched_file_id:
                return {"found": False}

            # Get all data for matched file
            pred = pa.compute.field("file_id") == matched_file_id
            files = table_to_records(s.table("files"), columns=FILES_COLUMNS, predicate=pred, limit=1)
            parts = table_to_records(parts_tbl, predicate=pred, limit=100)
            channels = table_to_records(s.table("channels"), columns=CHANNELS_COLUMNS, predicate=pred, limit=500)

        file_info = files[0] if files else {}
        first_part = parts[0] if parts else {}

        summary = {
            "resolution": f"{first_part.get('width', '?')}x{first_part.get('height', '?')}"
            if first_part.get("width") else "unknown",
            "compression": str(first_part.get("compression", "unknown")),
            "colorSpace": str(first_part.get("color_space", "unknown")),
            "channelCount": len(channels),
            "isDeep": bool(file_info.get("is_deep", False)),
            "frameNumber": file_info.get("frame_number"),
        }

        return {
            "found": True,
            "file": file_info,
            "parts": parts,
            "channels": channels,
            "summary": summary,
        }
    except HTTPException:
        raise
    except Exception as e:
        logger.exception("lookup query failed")
        raise HTTPException(503, detail=str(e))


if __name__ == "__main__":
    import uvicorn

    port = int(os.environ.get("PORT", "8070"))
    logger.info("Starting vastdb-query service on port %d", port)
    logger.info("Endpoint: %s, Bucket: %s, Schema: %s", ENDPOINT, DEFAULT_BUCKET, DEFAULT_SCHEMA)
    uvicorn.run(app, host="0.0.0.0", port=port)
