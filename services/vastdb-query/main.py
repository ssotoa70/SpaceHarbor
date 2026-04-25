"""
SpaceHarbor VAST Database Query Service.

Lightweight REST API that queries VAST Database tables using the vastdb
Python SDK. Designed to read tables created by DataEngine serverless
functions without requiring Trino.

Environment variables:
  VASTDB_ENDPOINT     - CNode VIP or S3 endpoint (required)
  VASTDB_ACCESS_KEY   - S3 access key (required)
  VASTDB_SECRET_KEY   - S3 secret key (required)
  VASTDB_BUCKET       - Database bucket (default: sergio-db)
  PORT                - HTTP port (default: 8070)

Note: Schema and table names are now passed per-request to the /metadata/lookup
endpoint, eliminating env-bound schema coupling.
"""

import logging
import os
from contextlib import contextmanager
from typing import Optional

import pyarrow as pa
import vastdb
from fastapi import FastAPI, HTTPException, Query, Response
from fastapi.middleware.cors import CORSMiddleware
from prometheus_client import Counter, generate_latest, CONTENT_TYPE_LATEST

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger("vastdb-query")

# ---------------------------------------------------------------------------
# Configuration
# ---------------------------------------------------------------------------

ENDPOINT = os.environ.get("VASTDB_ENDPOINT", "")
ACCESS_KEY = os.environ.get("VASTDB_ACCESS_KEY", "")
SECRET_KEY = os.environ.get("VASTDB_SECRET_KEY", "")
DEFAULT_BUCKET = os.environ.get("VASTDB_BUCKET", "sergio-db")


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

# ---------------------------------------------------------------------------
# Prometheus metrics
# ---------------------------------------------------------------------------
# Counter incremented each time /api/v1/metadata/lookup falls back from the
# primary bucket-prefixed key to the bucket-stripped variant. A sustained
# rate indicates extractor drift (the video-metadata-extractor stores
# s3_key without the bucket prefix while callers uniformly send the
# prefixed form). Ops should alert when rate(metadata_lookup_fallback_total[5m])
# is sustained above ~0.5/s — that threshold is empirical; tune per deployment.
# (A request-total counter may be added later to enable ratio-based alerting.)
metadata_lookup_fallback_total = Counter(
    "metadata_lookup_fallback_total",
    "Count of /metadata/lookup calls that hit via the bucket-stripped fallback path",
    ["schema", "table"],
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


@app.get("/metrics", include_in_schema=False)
def prometheus_metrics():
    """Prometheus scrape endpoint. Exposes all registered metrics in the
    standard text-based exposition format. No authentication — intended
    for scraping by a trusted in-cluster Prometheus agent."""
    return Response(content=generate_latest(), media_type=CONTENT_TYPE_LATEST)


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
# Routes
# ---------------------------------------------------------------------------

@app.get("/health")
def health():
    return {
        "status": "ok",
        "service": "vastdb-query",
        "endpoint": ENDPOINT or "not configured",
        "bucket": DEFAULT_BUCKET,
    }






# ---------------------------------------------------------------------------
# Schema-agnostic per-asset metadata lookup (Phase 5.4)
# ---------------------------------------------------------------------------
# Takes schema + table + path per request — no env-bound schema coupling,
# so pipeline platform settings become the single source of truth.
#
# SDK access pattern: `vast_transaction(bucket)` returns a Bucket object
# directly. SDK predicate pushdown isn't supported for this schema shape in the
# current vastdb release — we filter using Python-side filtering via
# `table_to_records(...)`.


def _strip_s3_prefix(path: str) -> str:
    """Strip only the `s3://` scheme, preserving the bucket in the path.

    Live verification against frame_metadata.files on sergio-db showed
    the extractor stores `bucket/key` (e.g. `sergio-spaceharbor/uploads/pixar_5603.exr`),
    NOT just the key. So the canonical form this endpoint expects is
    `{bucket}/{key}`; stripping only the scheme preserves callers'
    ability to pass the full `s3://bucket/key` URI."""
    if path.startswith("s3://"):
        return path[len("s3://"):]
    return path


@app.get("/api/v1/metadata/lookup")
def metadata_lookup(
    path: str = Query(..., description="S3 key or full s3:// URI"),
    schema: str = Query(..., description="Target VAST schema name (from pipeline config)"),
    table: str = Query("files", description="Target table name (default: files)"),
    bucket: Optional[str] = Query(None, description="VAST DB bucket (defaults to VASTDB_BUCKET env)"),
):
    """Schema-agnostic lookup of extractor output rows keyed by file path.

    Takes schema + table per request, decoupling from env-bound schema constants.
    Intended caller: control-plane /assets/:id/metadata, which passes the
    asset's pipeline config's targetSchema/targetTable.

    Bucket-stripped fallback (Bug B): video-metadata-extractor stores
    s3_key WITHOUT bucket prefix, while frame-metadata-extractor stores
    file_path WITH bucket prefix. Callers uniformly send the bucket-
    prefixed form. If the primary match is empty AND the path contains
    a slash, we re-filter the already-fetched rows with the bucket
    stripped. A warn log fires on fallback hit so ops can spot extractor
    drift.
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
            # Primary: filter by the bucket-prefixed key (callers' canonical form)
            rows = [r for r in all_rows if r.get(match_col) == key]

            # Bucket-stripped fallback. Only re-filter if primary was empty
            # AND path has something left after the first slash to strip.
            if not rows and "/" in key:
                fallback_key = key.split("/", 1)[1]
                if fallback_key:  # guard against trailing slash edge case
                    rows = [r for r in all_rows if r.get(match_col) == fallback_key]
                    if rows:
                        logger.warning(
                            "metadata_lookup.fallback_hit path=%s fallback=%s schema=%s table=%s match_col=%s",
                            path, fallback_key, schema, table, match_col,
                        )
                        metadata_lookup_fallback_total.labels(
                            schema=schema, table=table
                        ).inc()

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
        "Endpoint: %s, Bucket: %s",
        ENDPOINT, DEFAULT_BUCKET,
    )
    uvicorn.run(app, host="0.0.0.0", port=port)
