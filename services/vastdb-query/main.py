"""
SpaceHarbor VAST Database Query Service.

Lightweight REST API that queries VAST Database tables using the vastdb
Python SDK. Designed to read tables created by DataEngine serverless
functions (e.g. exr-inspector, video-metadata-extractor) without requiring
Trino.

Environment variables:
  VASTDB_ENDPOINT     - CNode VIP or S3 endpoint (required)
  VASTDB_ACCESS_KEY   - S3 access key (required)
  VASTDB_SECRET_KEY   - S3 secret key (required)
  VASTDB_BUCKET       - Database bucket (default: sergio-db)

  # oiio-proxy-generator / exr-inspector output (image path)
  VASTDB_SCHEMA       - EXR metadata schema name (default: exr_metadata)

  # video-metadata-extractor output (video path)
  VASTDB_VIDEO_SCHEMA - Video metadata schema name (default: video_metadata)
  VASTDB_VIDEO_TABLE  - Table name inside the video schema (default: files)

  PORT                - HTTP port (default: 8070)

All schema and table names MUST be env-configurable. Never hardcode.
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

# EXR metadata (oiio-proxy-generator / exr-inspector) — legacy var name kept
# for back-compat with existing deployments.
DEFAULT_SCHEMA = os.environ.get("VASTDB_SCHEMA", "exr_metadata_2")

# Video metadata (video-metadata-extractor). Schema and table are both
# env-configurable — the functions team owns the table definition and may
# rename either without touching this service.
DEFAULT_VIDEO_SCHEMA = os.environ.get("VASTDB_VIDEO_SCHEMA", "video_metadata")
DEFAULT_VIDEO_TABLE = os.environ.get("VASTDB_VIDEO_TABLE", "files")

# ---------------------------------------------------------------------------
# Schema-agnostic metadata lookup — Phase 5.4 (asset metadata DB reader)
# ---------------------------------------------------------------------------

# Priority order for the column the caller's `path` is matched against.
# First column present in the target table (case-insensitive) wins.
MATCH_COLUMN_PRIORITY: tuple[str, ...] = (
    "source_uri",
    "s3_key",
    "path",
    "file_path",
    "uri",
)


def resolve_match_column(column_names: list[str]) -> Optional[str]:
    """Return the first column from MATCH_COLUMN_PRIORITY that is present in
    ``column_names`` (case-insensitive), preserving the column's original
    casing. Returns None when none match — the caller should surface that
    as a 400 with the list of available columns so misconfiguration is
    visible, not silent."""
    lower_map = {c.lower(): c for c in column_names}
    for wanted in MATCH_COLUMN_PRIORITY:
        if wanted in lower_map:
            return lower_map[wanted]
    return None


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
    predicate=None,
    limit: int = 100,
) -> list[dict]:
    """Read a VAST table and return as list of dicts."""
    kwargs = {}
    if columns:
        kwargs["columns"] = columns
    if predicate is not None:
        kwargs["predicate"] = predicate

    try:
        reader = table.select(**kwargs)
        arrow_table = reader.read_all()
    except (TypeError, AttributeError):
        # vastdb SDK may not support pyarrow predicates — read all and filter in Python
        reader = table.select(columns=columns) if columns else table.select()
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
        "exr_schema": DEFAULT_SCHEMA,
        "video_schema": DEFAULT_VIDEO_SCHEMA,
        "video_table": DEFAULT_VIDEO_TABLE,
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
            records = table_to_records(tbl, columns=FILES_COLUMNS, limit=10000)

        # Filter by path prefix in Python
        if pathPrefix:
            records = [r for r in records if str(r.get("file_path", "")).startswith(pathPrefix)]

        total = len(records)
        paged = records[offset:offset + limit]
        return {"files": paged, "total": total, "schema": f"{bucket}/{schema}"}
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

            all_files = table_to_records(s.table("files"), columns=FILES_COLUMNS, limit=10000)
            files = [f for f in all_files if f.get("file_id") == file_id]
            if not files:
                raise HTTPException(404, detail=f"File not found: {file_id}")

            all_parts = table_to_records(s.table("parts"), limit=10000)
            parts = [p for p in all_parts if p.get("file_id") == file_id]

            all_channels = table_to_records(s.table("channels"), columns=CHANNELS_COLUMNS, limit=50000)
            channels = [c for c in all_channels if c.get("file_id") == file_id]

            all_attrs = table_to_records(s.table("attributes"), limit=50000)
            attributes = [a for a in all_attrs if a.get("file_id") == file_id]

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

            # Get all data for matched file (filter in Python — vastdb SDK predicate compat)
            all_files = table_to_records(s.table("files"), columns=FILES_COLUMNS, limit=10000)
            files = [f for f in all_files if f.get("file_id") == matched_file_id]

            parts = [p for p in all_parts if p.get("file_id") == matched_file_id]

            all_channels = table_to_records(s.table("channels"), columns=CHANNELS_COLUMNS, limit=50000)
            channels = [c for c in all_channels if c.get("file_id") == matched_file_id]

            all_attrs = table_to_records(s.table("attributes"), limit=50000)
            attributes = [a for a in all_attrs if a.get("file_id") == matched_file_id]

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
            "attributes": attributes,
            "summary": summary,
        }
    except HTTPException:
        raise
    except Exception as e:
        logger.exception("lookup query failed")
        raise HTTPException(503, detail=str(e))


# ---------------------------------------------------------------------------
# Video metadata routes (video-metadata-extractor output)
#
# video-metadata-extractor writes a single flat table (default name "files"
# inside the "video_metadata" schema) with one row per processed video /
# raw-camera file. Unlike the EXR path, we don't know the exact column set
# at write time — the functions team can add columns freely. Endpoints below
# are therefore schema-agnostic: they return raw rows plus a best-effort
# "summary" dict that picks well-known field names if present.
#
# The UI (StorageBrowserPage FileDetailSidebar and AssetBrowser MediaPreview)
# renders the response as dynamic fields (summary on top, attributes below)
# per the feedback_ui_dynamic_fields memory rule.
# ---------------------------------------------------------------------------

# Well-known column names the function is LIKELY to emit. If present we
# surface them in the `summary` dict as a UX convenience. If absent we
# silently skip them. NEVER REQUIRE any of these — the table contract is
# owned by the functions team and this list is advisory only.
_VIDEO_SUMMARY_FIELDS = {
    # Logical summary field → list of candidate column names (first match wins)
    "resolution": None,  # computed from width+height, special-cased below
    "codec":      ["codec", "video_codec", "codec_name"],
    "duration":   ["duration_sec", "duration_seconds", "duration", "duration_ms"],
    "fps":        ["fps", "frame_rate", "framerate"],
    "bitrate":    ["bitrate_bps", "bitrate", "bit_rate"],
    "colorSpace": ["color_space", "colorspace", "color_primaries"],
    "hdr":        ["hdr_format", "hdr", "transfer_function"],
    "audioChannels": ["audio_channels", "channel_count"],
    "cameraMake": ["camera_make", "make", "device_make"],
    "cameraModel": ["camera_model", "model", "device_model"],
    "timecodeStart": ["timecode_start", "start_timecode"],
    "rawMetadataOnly": ["braw_metadata_only", "raw_metadata_only"],
}


def _compute_video_summary(row: dict) -> dict:
    """Best-effort summary from a raw video metadata row. Skips fields that
    don't exist. Never throws on missing columns."""
    summary: dict = {}

    # Resolution: special-case because it needs two columns
    width = row.get("width") or row.get("w")
    height = row.get("height") or row.get("h")
    if width and height:
        summary["resolution"] = f"{width}x{height}"

    for logical, candidates in _VIDEO_SUMMARY_FIELDS.items():
        if logical == "resolution":
            continue  # handled above
        if candidates is None:
            continue
        for col in candidates:
            if col in row and row[col] is not None and row[col] != "":
                summary[logical] = row[col]
                break
    return summary


def _row_to_attributes(row: dict, exclude: Optional[set] = None) -> list[dict]:
    """Flatten any row into a list of {name, value} pairs for generic UI rendering."""
    exclude = exclude or set()
    out = []
    for key, value in row.items():
        if key in exclude:
            continue
        if value is None or value == "":
            continue
        # pyarrow may give us bytes/datetime/etc — stringify for transport safety
        if isinstance(value, (bytes, bytearray)):
            value = value.decode("utf-8", errors="replace")
        out.append({"name": key, "value": value})
    return out


@app.get("/api/v1/video-metadata/stats")
def video_stats(
    bucket: str = Query(DEFAULT_BUCKET),
    schema: str = Query(DEFAULT_VIDEO_SCHEMA),
    table: str = Query(DEFAULT_VIDEO_TABLE),
):
    """Count rows in the video metadata table."""
    try:
        with vast_transaction(bucket) as bkt:
            s = bkt.schema(schema)
            records = table_to_records(s.table(table), limit=1000000)
        return {
            "totalFiles": len(records),
            "schema": f"{bucket}/{schema}",
            "table": table,
        }
    except HTTPException:
        raise
    except Exception as e:
        # Missing schema / table is a common state until the functions team
        # ships — return a 200 with zero counts so the UI degrades gracefully.
        logger.info("video stats query failed (schema/table may not exist yet): %s", e)
        return {
            "totalFiles": 0,
            "schema": f"{bucket}/{schema}",
            "table": table,
            "error": str(e),
        }


@app.get("/api/v1/video-metadata/files")
def video_files(
    bucket: str = Query(DEFAULT_BUCKET),
    schema: str = Query(DEFAULT_VIDEO_SCHEMA),
    table: str = Query(DEFAULT_VIDEO_TABLE),
    pathPrefix: Optional[str] = Query(None),
    limit: int = Query(50, ge=1, le=500),
    offset: int = Query(0, ge=0),
):
    """List video metadata rows with optional path-prefix filter."""
    try:
        with vast_transaction(bucket) as bkt:
            s = bkt.schema(schema)
            records = table_to_records(s.table(table), limit=10000)

        if pathPrefix:
            records = [
                r for r in records
                if str(r.get("file_path", r.get("s3_key", ""))).startswith(pathPrefix)
            ]

        total = len(records)
        paged = records[offset:offset + limit]
        return {
            "files": paged,
            "total": total,
            "schema": f"{bucket}/{schema}",
            "table": table,
        }
    except HTTPException:
        raise
    except Exception as e:
        logger.info("video files query failed: %s", e)
        return {"files": [], "total": 0, "schema": f"{bucket}/{schema}", "table": table, "error": str(e)}


@app.get("/api/v1/video-metadata/files/{file_id}")
def video_file_detail(
    file_id: str,
    bucket: str = Query(DEFAULT_BUCKET),
    schema: str = Query(DEFAULT_VIDEO_SCHEMA),
    table: str = Query(DEFAULT_VIDEO_TABLE),
):
    """Get full detail for one video file by id."""
    try:
        with vast_transaction(bucket) as bkt:
            s = bkt.schema(schema)
            records = table_to_records(s.table(table), limit=10000)

        # Match on any id-like column the function might use
        match = None
        for r in records:
            if (
                str(r.get("file_id", "")) == file_id
                or str(r.get("id", "")) == file_id
                or str(r.get("guid", "")) == file_id
            ):
                match = r
                break
        if not match:
            raise HTTPException(404, detail=f"Video metadata row not found: {file_id}")

        summary = _compute_video_summary(match)
        attributes = _row_to_attributes(match, exclude={"file_id", "id", "guid"})
        return {"file": match, "summary": summary, "attributes": attributes}
    except HTTPException:
        raise
    except Exception as e:
        logger.info("video file detail query failed: %s", e)
        raise HTTPException(503, detail=str(e))


@app.get("/api/v1/video-metadata/lookup")
def video_lookup(
    path: str = Query(..., description="File path or S3 URI to look up"),
    bucket: str = Query(DEFAULT_BUCKET),
    schema: str = Query(DEFAULT_VIDEO_SCHEMA),
    table: str = Query(DEFAULT_VIDEO_TABLE),
):
    """Look up video metadata by file path or filename.

    Matches on any of `file_path`, `s3_key`, or the bare filename from any of
    those columns. The function writer may use any column name convention;
    we try several to be robust to schema drift.
    """
    filename = path.rsplit("/", 1)[-1] if "/" in path else path
    # Strip any s3://bucket/ prefix for comparison
    normalized = path
    for prefix in ("s3://", "vast://"):
        if normalized.startswith(prefix):
            parts = normalized.split("/", 3)
            normalized = "/" + parts[-1] if len(parts) >= 4 else normalized

    try:
        with vast_transaction(bucket) as bkt:
            s = bkt.schema(schema)
            records = table_to_records(s.table(table), limit=10000)

        match = None
        for r in records:
            # Try several column names the functions team might choose
            for col in ("file_path", "s3_key", "path", "source_uri", "filename"):
                val = str(r.get(col, ""))
                if not val:
                    continue
                val_name = val.rsplit("/", 1)[-1] if "/" in val else val
                if val == path or val == normalized or val_name == filename:
                    match = r
                    break
            if match:
                break

        if not match:
            return {"found": False}

        summary = _compute_video_summary(match)
        attributes = _row_to_attributes(
            match,
            exclude={"file_id", "id", "guid", "file_path", "s3_key", "path", "source_uri", "filename"},
        )
        return {
            "found": True,
            "file": match,
            "summary": summary,
            "attributes": attributes,
        }
    except HTTPException:
        raise
    except Exception as e:
        # Same graceful-degradation pattern as stats: log and return not-found
        # so the UI falls back to the "no metadata" state instead of erroring.
        logger.info("video lookup query failed: %s", e)
        return {"found": False, "error": str(e)}


# ---------------------------------------------------------------------------
# Schema-agnostic per-asset metadata lookup (Phase 5.4)
# ---------------------------------------------------------------------------
# Takes schema + table + path per request — no env-bound schema coupling,
# so pipeline platform settings become the single source of truth.
#
# SDK access pattern: `vast_transaction(bucket)` returns a Bucket object
# directly (see existing /exr-metadata/lookup + /video-metadata/lookup).
# SDK predicate pushdown isn't supported for this schema shape in the
# current vastdb release — commit 5786cab switched the other endpoints
# to Python-side filtering via `table_to_records(...)`. We follow the
# same pattern here for consistency and correctness.


def _strip_s3_prefix(path: str) -> str:
    """Accept either `s3://<bucket>/<key>` or a bare `<key>`; return `<key>`.
    Extractors typically store just the key, so callers can pass the full
    source URI without thinking about it."""
    if path.startswith("s3://"):
        without_scheme = path[len("s3://"):]
        first_slash = without_scheme.find("/")
        return without_scheme[first_slash + 1:] if first_slash > 0 else without_scheme
    return path


@app.get("/api/v1/metadata/lookup")
def metadata_lookup(
    path: str = Query(..., description="S3 key or full s3:// URI"),
    schema: str = Query(..., description="Target VAST schema name (from pipeline config)"),
    table: str = Query("files", description="Target table name (default: files)"),
    bucket: Optional[str] = Query(None, description="VAST DB bucket (defaults to VASTDB_BUCKET env)"),
):
    """Schema-agnostic lookup of extractor output rows keyed by file path.

    Unlike /exr-metadata/lookup and /video-metadata/lookup (both hardcoded
    to env-bound schemas), this endpoint takes schema + table per request.
    Intended caller: control-plane /assets/:id/metadata, which passes the
    asset's pipeline config's targetSchema/targetTable.
    """
    key = _strip_s3_prefix(path)
    target_bucket = bucket or DEFAULT_BUCKET
    try:
        with vast_transaction(bucket=target_bucket) as bkt:
            # vast_transaction returns a Bucket; its `.schema(name)` yields
            # a Schema, and `.table(name)` yields a Table. Matches the
            # pattern used by /exr-metadata/lookup and /video-metadata/lookup.
            schema_obj = bkt.schema(schema)
            table_obj = schema_obj.table(table)
            # Read everything and filter in Python. SDK predicate pushdown
            # isn't supported here; table.columns is a method not an
            # iterable, so we derive column names from the first row's
            # dict keys. Tables are typically O(100s) of rows for per-asset
            # metadata — a full scan is acceptable.
            all_rows = table_to_records(table_obj, limit=10000)
            if not all_rows:
                # Empty table — nothing to match against. Return a clean
                # zero-count response; downstream consumers treat this as
                # "extractor hasn't produced output yet".
                return {
                    "rows": [],
                    "bucket": target_bucket,
                    "schema": schema,
                    "table": table,
                    "matched_by": None,
                    "count": 0,
                }
            column_names = list(all_rows[0].keys())
            match_col = resolve_match_column(column_names)
            if match_col is None:
                raise HTTPException(
                    status_code=400,
                    detail=(
                        f"Target table {schema}.{table} has no recognized "
                        f"path-match column. Expected one of "
                        f"{list(MATCH_COLUMN_PRIORITY)}; got {column_names}."
                    ),
                )
            rows = [r for r in all_rows if r.get(match_col) == key]
            return {
                "rows": rows,
                "bucket": target_bucket,
                "schema": schema,
                "table": table,
                "matched_by": match_col,
                "count": len(rows),
            }
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=503, detail=str(e))


if __name__ == "__main__":
    import uvicorn

    port = int(os.environ.get("PORT", "8070"))
    logger.info("Starting vastdb-query service on port %d", port)
    logger.info(
        "Endpoint: %s, Bucket: %s, EXR Schema: %s, Video Schema: %s, Video Table: %s",
        ENDPOINT, DEFAULT_BUCKET, DEFAULT_SCHEMA, DEFAULT_VIDEO_SCHEMA, DEFAULT_VIDEO_TABLE,
    )
    uvicorn.run(app, host="0.0.0.0", port=port)
