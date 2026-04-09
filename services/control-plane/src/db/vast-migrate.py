#!/usr/bin/env python3
"""
SpaceHarbor VAST Database Migration Tool

Creates all SpaceHarbor database tables using the vastdb Python SDK.
Supports idempotent creation (skips existing tables) and JSON output for Node.js callers.

Usage:
  python3 vast-migrate.py [OPTIONS]

Environment Variables:
  VAST_DB_ENDPOINT    - S3/VAST endpoint URL
  VAST_DB_ACCESS_KEY  - S3 access key
  VAST_DB_SECRET_KEY  - S3 secret key
  VAST_DB_BUCKET      - Database bucket name (default: spaceharbor)
  VAST_DB_SCHEMA      - Schema name (default: spaceharbor)

Options:
  --endpoint URL              Override VAST_DB_ENDPOINT
  --access-key KEY            Override VAST_DB_ACCESS_KEY
  --secret-key SECRET         Override VAST_DB_SECRET_KEY
  --bucket BUCKET             Override VAST_DB_BUCKET
  --schema SCHEMA             Override VAST_DB_SCHEMA
  --dry-run                   List tables without creating them
  --ssl-verify                Enable SSL certificate verification (default: False)
  --help                      Show this help message

Output:
  JSON on last line: {"status":"ok",...} or {"status":"error",...}
  Exit code: 0 on success, 1 on failure
"""

import argparse
import json
import sys
import ssl
from typing import Any, Dict, List, Optional, Tuple
from datetime import datetime

try:
    import pyarrow as pa
    import vastdb
except ImportError:
    print("ERROR: Missing required packages. Install with:", file=sys.stderr)
    print("  pip install vastdb pyarrow", file=sys.stderr)
    sys.exit(1)


# Disable SSL verification for self-signed certs if needed
def configure_ssl(verify: bool) -> None:
    if not verify:
        ssl._create_default_https_context = ssl._create_unverified_context


class TableDefinition:
    """Represents a table to be created."""

    def __init__(self, name: str, schema: pa.Schema, migration_version: int):
        self.name = name
        self.schema = schema
        self.migration_version = migration_version


def log_info(msg: str) -> None:
    """Log to stderr to keep stdout clean for JSON output."""
    print(f"[{datetime.now().isoformat()}] {msg}", file=sys.stderr)


def log_error(msg: str) -> None:
    """Log error to stderr."""
    print(f"[ERROR] {msg}", file=sys.stderr)


def get_table_definitions() -> List[TableDefinition]:
    """Return all table definitions organized by migration version."""
    tables = []

    # Migration 001: VFX Hierarchy
    tables.extend([
        TableDefinition("projects", pa.schema([
            ("id", pa.string()),
            ("code", pa.string()),
            ("name", pa.string()),
            ("type", pa.string()),
            ("status", pa.string()),
            ("frame_rate", pa.float64()),
            ("color_space", pa.string()),
            ("resolution_w", pa.int32()),
            ("resolution_h", pa.int32()),
            ("start_date", pa.timestamp("us")),
            ("delivery_date", pa.timestamp("us")),
            ("owner", pa.string()),
            ("created_at", pa.timestamp("us")),
            ("updated_at", pa.timestamp("us")),
        ]), 1),
        TableDefinition("sequences", pa.schema([
            ("id", pa.string()),
            ("project_id", pa.string()),
            ("code", pa.string()),
            ("episode", pa.string()),
            ("name", pa.string()),
            ("status", pa.string()),
            ("shot_count", pa.int32()),
            ("frame_range_start", pa.int32()),
            ("frame_range_end", pa.int32()),
            ("created_at", pa.timestamp("us")),
            ("updated_at", pa.timestamp("us")),
        ]), 1),
        TableDefinition("shots", pa.schema([
            ("id", pa.string()),
            ("project_id", pa.string()),
            ("sequence_id", pa.string()),
            ("code", pa.string()),
            ("name", pa.string()),
            ("status", pa.string()),
            ("frame_range_start", pa.int32()),
            ("frame_range_end", pa.int32()),
            ("frame_count", pa.int32()),
            ("frame_rate", pa.float64()),
            ("vendor", pa.string()),
            ("lead", pa.string()),
            ("priority", pa.string()),
            ("due_date", pa.timestamp("us")),
            ("notes", pa.string()),
            ("latest_version_id", pa.string()),
            ("created_at", pa.timestamp("us")),
            ("updated_at", pa.timestamp("us")),
        ]), 1),
        TableDefinition("versions", pa.schema([
            ("id", pa.string()),
            ("shot_id", pa.string()),
            ("project_id", pa.string()),
            ("sequence_id", pa.string()),
            ("version_label", pa.string()),
            ("version_number", pa.int32()),
            ("parent_version_id", pa.string()),
            ("status", pa.string()),
            ("media_type", pa.string()),
            ("codec", pa.string()),
            ("resolution_w", pa.int32()),
            ("resolution_h", pa.int32()),
            ("frame_rate", pa.float64()),
            ("frame_range_start", pa.int32()),
            ("frame_range_end", pa.int32()),
            ("pixel_aspect_ratio", pa.float64()),
            ("display_window", pa.string()),  # ROW -> JSON string
            ("data_window", pa.string()),      # ROW -> JSON string
            ("compression_type", pa.string()),
            ("color_space", pa.string()),
            ("bit_depth", pa.int32()),
            ("channel_count", pa.int32()),
            ("file_size_bytes", pa.int64()),
            ("md5_checksum", pa.string()),
            ("vast_element_handle", pa.string()),
            ("vast_path", pa.string()),
            ("created_by", pa.string()),
            ("created_at", pa.timestamp("us")),
            ("published_at", pa.timestamp("us")),
            ("notes", pa.string()),
        ]), 1),
        TableDefinition("version_assets", pa.schema([
            ("id", pa.string()),
            ("version_id", pa.string()),
            ("asset_id", pa.string()),
            ("role", pa.string()),
            ("created_at", pa.timestamp("us")),
        ]), 1),
        TableDefinition("version_approvals", pa.schema([
            ("id", pa.string()),
            ("version_id", pa.string()),
            ("shot_id", pa.string()),
            ("project_id", pa.string()),
            ("action", pa.string()),
            ("performed_by", pa.string()),
            ("role", pa.string()),
            ("note", pa.string()),
            ("at", pa.timestamp("us")),
        ]), 1),
        TableDefinition("schema_version", pa.schema([
            ("version", pa.int32()),
            ("applied_at", pa.timestamp("us")),
            ("description", pa.string()),
        ]), 1),
    ])

    # Migration 002: Episode and Task entities
    tables.extend([
        TableDefinition("episodes", pa.schema([
            ("id", pa.string()),
            ("project_id", pa.string()),
            ("code", pa.string()),
            ("name", pa.string()),
            ("status", pa.string()),
            ("sequence_count", pa.int32()),
            ("created_at", pa.timestamp("us")),
            ("updated_at", pa.timestamp("us")),
        ]), 2),
        TableDefinition("tasks", pa.schema([
            ("id", pa.string()),
            ("shot_id", pa.string()),
            ("project_id", pa.string()),
            ("sequence_id", pa.string()),
            ("code", pa.string()),
            ("type", pa.string()),
            ("status", pa.string()),
            ("assignee", pa.string()),
            ("due_date", pa.timestamp("us")),
            ("task_number", pa.int32()),
            ("notes", pa.string()),
            ("created_at", pa.timestamp("us")),
            ("updated_at", pa.timestamp("us")),
        ]), 2),
        TableDefinition("episode_sequences", pa.schema([
            ("episode_id", pa.string()),
            ("sequence_id", pa.string()),
            ("created_at", pa.timestamp("us")),
        ]), 2),
        TableDefinition("version_tasks", pa.schema([
            ("task_id", pa.string()),
            ("version_id", pa.string()),
            ("created_at", pa.timestamp("us")),
        ]), 2),
    ])

    # Migration 003: Review Status
    tables.append(
        TableDefinition("version_review_status", pa.schema([
            ("version_id", pa.string()),
            ("review_status", pa.string()),
            ("updated_at", pa.timestamp("us")),
        ]), 3)
    )

    # Migration 004: Version Frame Handles
    tables.append(
        TableDefinition("version_frame_handles", pa.schema([
            ("version_id", pa.string()),
            ("head_handle", pa.int32()),
            ("tail_handle", pa.int32()),
            ("updated_at", pa.timestamp("us")),
        ]), 4)
    )

    # Migration 005: MaterialX Materials
    tables.extend([
        TableDefinition("materials", pa.schema([
            ("id", pa.string()),
            ("project_id", pa.string()),
            ("name", pa.string()),
            ("description", pa.string()),
            ("status", pa.string()),
            ("created_by", pa.string()),
            ("created_at", pa.timestamp("us")),
            ("updated_at", pa.timestamp("us")),
        ]), 5),
        TableDefinition("material_versions", pa.schema([
            ("id", pa.string()),
            ("material_id", pa.string()),
            ("version_number", pa.int32()),
            ("version_label", pa.string()),
            ("parent_version_id", pa.string()),
            ("status", pa.string()),
            ("source_path", pa.string()),
            ("content_hash", pa.string()),
            ("usd_material_path", pa.string()),
            ("render_contexts", pa.string()),  # ARRAY -> JSON string
            ("colorspace_config", pa.string()),
            ("mtlx_spec_version", pa.string()),
            ("look_names", pa.string()),  # ARRAY -> JSON string
            ("vast_element_handle", pa.string()),
            ("vast_path", pa.string()),
            ("created_by", pa.string()),
            ("created_at", pa.timestamp("us")),
            ("published_at", pa.timestamp("us")),
        ]), 5),
        TableDefinition("look_variants", pa.schema([
            ("id", pa.string()),
            ("material_version_id", pa.string()),
            ("look_name", pa.string()),
            ("description", pa.string()),
            ("material_assigns", pa.string()),
            ("created_at", pa.timestamp("us")),
        ]), 5),
        TableDefinition("version_material_bindings", pa.schema([
            ("id", pa.string()),
            ("look_variant_id", pa.string()),
            ("version_id", pa.string()),
            ("bound_by", pa.string()),
            ("bound_at", pa.timestamp("us")),
        ]), 5),
        TableDefinition("material_dependencies", pa.schema([
            ("id", pa.string()),
            ("material_version_id", pa.string()),
            ("texture_path", pa.string()),
            ("content_hash", pa.string()),
            ("texture_type", pa.string()),
            ("colorspace", pa.string()),
            ("dependency_depth", pa.int32()),
            ("created_at", pa.timestamp("us")),
        ]), 5),
    ])

    # Migration 006: Workflow Tables
    tables.extend([
        TableDefinition("assets", pa.schema([
            ("id", pa.string()),
            ("title", pa.string()),
            ("source_uri", pa.string()),
            ("shot_id", pa.string()),
            ("project_id", pa.string()),
            ("version_label", pa.string()),
            ("review_uri", pa.string()),
            ("metadata", pa.string()),
            ("version_info", pa.string()),
            ("integrity", pa.string()),
            ("created_at", pa.timestamp("us")),
            ("updated_at", pa.timestamp("us")),
        ]), 6),
        TableDefinition("jobs", pa.schema([
            ("id", pa.string()),
            ("asset_id", pa.string()),
            ("source_uri", pa.string()),
            ("status", pa.string()),
            ("attempt_count", pa.int32()),
            ("max_attempts", pa.int32()),
            ("last_error", pa.string()),
            ("next_attempt_at", pa.timestamp("us")),
            ("lease_owner", pa.string()),
            ("lease_expires_at", pa.timestamp("us")),
            ("thumbnail", pa.string()),
            ("proxy", pa.string()),
            ("annotation_hook", pa.string()),
            ("handoff_checklist", pa.string()),
            ("handoff", pa.string()),
            ("created_at", pa.timestamp("us")),
            ("updated_at", pa.timestamp("us")),
        ]), 6),
        TableDefinition("queue", pa.schema([
            ("job_id", pa.string()),
            ("asset_id", pa.string()),
            ("available_at", pa.timestamp("us")),
            ("lease_owner", pa.string()),
            ("lease_expires_at", pa.timestamp("us")),
        ]), 6),
        TableDefinition("dlq", pa.schema([
            ("id", pa.string()),
            ("job_id", pa.string()),
            ("asset_id", pa.string()),
            ("error", pa.string()),
            ("attempt_count", pa.int32()),
            ("failed_at", pa.timestamp("us")),
        ]), 6),
        TableDefinition("outbox", pa.schema([
            ("id", pa.string()),
            ("event_type", pa.string()),
            ("correlation_id", pa.string()),
            ("payload", pa.string()),
            ("created_at", pa.timestamp("us")),
            ("published_at", pa.timestamp("us")),
        ]), 6),
        TableDefinition("audit_log", pa.schema([
            ("id", pa.string()),
            ("message", pa.string()),
            ("at", pa.timestamp("us")),
            ("signal", pa.string()),
        ]), 6),
        TableDefinition("processed_events", pa.schema([
            ("event_id", pa.string()),
            ("processed_at", pa.timestamp("us")),
        ]), 6),
        TableDefinition("incident_coordination", pa.schema([
            ("id", pa.string()),
            ("acknowledged", pa.bool_()),
            ("owner", pa.string()),
            ("escalated", pa.bool_()),
            ("next_update_eta", pa.timestamp("us")),
            ("guided_updated_at", pa.timestamp("us")),
            ("handoff_state", pa.string()),
            ("handoff_from", pa.string()),
            ("handoff_to", pa.string()),
            ("handoff_summary", pa.string()),
            ("handoff_updated_at", pa.timestamp("us")),
        ]), 6),
        TableDefinition("incident_notes", pa.schema([
            ("id", pa.string()),
            ("message", pa.string()),
            ("correlation_id", pa.string()),
            ("author", pa.string()),
            ("at", pa.timestamp("us")),
        ]), 6),
        TableDefinition("approval_audit", pa.schema([
            ("id", pa.string()),
            ("asset_id", pa.string()),
            ("action", pa.string()),
            ("performed_by", pa.string()),
            ("note", pa.string()),
            ("at", pa.timestamp("us")),
        ]), 6),
        TableDefinition("dcc_audit", pa.schema([
            ("id", pa.string()),
            ("session_id", pa.string()),
            ("operation", pa.string()),
            ("entity_ref", pa.string()),
            ("trait_set", pa.string()),
            ("result", pa.string()),
            ("duration_ms", pa.int32()),
            ("at", pa.timestamp("us")),
        ]), 6),
        TableDefinition("timelines", pa.schema([
            ("id", pa.string()),
            ("name", pa.string()),
            ("project_id", pa.string()),
            ("frame_rate", pa.float64()),
            ("duration_frames", pa.int32()),
            ("source_uri", pa.string()),
            ("status", pa.string()),
            ("created_at", pa.timestamp("us")),
            ("updated_at", pa.timestamp("us")),
        ]), 6),
        TableDefinition("timeline_clips", pa.schema([
            ("id", pa.string()),
            ("timeline_id", pa.string()),
            ("track_name", pa.string()),
            ("clip_name", pa.string()),
            ("source_uri", pa.string()),
            ("in_frame", pa.int32()),
            ("out_frame", pa.int32()),
            ("duration_frames", pa.int32()),
            ("shot_name", pa.string()),
            ("conform_status", pa.string()),
            ("matched_shot_id", pa.string()),
            ("matched_asset_id", pa.string()),
            ("created_at", pa.timestamp("us")),
        ]), 6),
    ])

    # Migration 007: Review Sessions
    tables.extend([
        TableDefinition("review_sessions", pa.schema([
            ("id", pa.string()),
            ("project_id", pa.string()),
            ("department", pa.string()),
            ("session_date", pa.string()),  # DATE -> string
            ("session_type", pa.string()),
            ("supervisor_id", pa.string()),
            ("status", pa.string()),
            ("created_at", pa.timestamp("us")),
        ]), 7),
        TableDefinition("review_session_submissions", pa.schema([
            ("id", pa.string()),
            ("session_id", pa.string()),
            ("asset_id", pa.string()),
            ("version_id", pa.string()),
            ("submission_order", pa.int32()),
            ("status", pa.string()),
            ("submitted_at", pa.timestamp("us")),
        ]), 7),
    ])

    # Migration 008: Timeline Enhancements
    tables.extend([
        TableDefinition("timeline_clip_details", pa.schema([
            ("clip_id", pa.string()),
            ("vfx_cut_in", pa.int32()),
            ("vfx_cut_out", pa.int32()),
            ("handle_head", pa.int32()),
            ("handle_tail", pa.int32()),
            ("delivery_in", pa.int32()),
            ("delivery_out", pa.int32()),
            ("source_timecode", pa.string()),
        ]), 8),
        TableDefinition("timeline_change_sets", pa.schema([
            ("id", pa.string()),
            ("timeline_id", pa.string()),
            ("previous_timeline_id", pa.string()),
            ("changes", pa.string()),
            ("created_at", pa.timestamp("us")),
        ]), 8),
        TableDefinition("approval_audit_links", pa.schema([
            ("audit_id", pa.string()),
            ("version_id", pa.string()),
            ("session_id", pa.string()),
        ]), 8),
        TableDefinition("version_media_urls", pa.schema([
            ("version_id", pa.string()),
            ("thumbnail_url", pa.string()),
            ("proxy_url", pa.string()),
            ("updated_at", pa.timestamp("us")),
        ]), 8),
    ])

    # Migration 009: Review Workflow
    tables.extend([
        TableDefinition("review_comments", pa.schema([
            ("id", pa.string()),
            ("session_id", pa.string()),
            ("submission_id", pa.string()),
            ("version_id", pa.string()),
            ("parent_comment_id", pa.string()),
            ("author_id", pa.string()),
            ("author_role", pa.string()),
            ("body", pa.string()),
            ("frame_number", pa.int32()),
            ("timecode", pa.string()),
            ("annotation_type", pa.string()),
            ("status", pa.string()),
            ("created_at", pa.timestamp("us")),
            ("updated_at", pa.timestamp("us")),
        ]), 9),
        TableDefinition("comment_annotations", pa.schema([
            ("id", pa.string()),
            ("comment_id", pa.string()),
            ("annotation_data", pa.string()),
            ("frame_number", pa.int32()),
        ]), 9),
        TableDefinition("version_comparisons", pa.schema([
            ("id", pa.string()),
            ("version_a_id", pa.string()),
            ("version_b_id", pa.string()),
            ("comparison_type", pa.string()),
            ("diff_metadata", pa.string()),
            ("pixel_diff_percentage", pa.float64()),
            ("frame_diff_count", pa.int32()),
            ("resolution_match", pa.bool_()),
            ("colorspace_match", pa.bool_()),
            ("created_at", pa.timestamp("us")),
            ("created_by", pa.string()),
        ]), 9),
        TableDefinition("collections", pa.schema([
            ("id", pa.string()),
            ("project_id", pa.string()),
            ("name", pa.string()),
            ("description", pa.string()),
            ("collection_type", pa.string()),
            ("owner_id", pa.string()),
            ("status", pa.string()),
            ("created_at", pa.timestamp("us")),
            ("updated_at", pa.timestamp("us")),
        ]), 9),
        TableDefinition("collection_items", pa.schema([
            ("id", pa.string()),
            ("collection_id", pa.string()),
            ("entity_type", pa.string()),
            ("entity_id", pa.string()),
            ("sort_order", pa.int32()),
            ("added_by", pa.string()),
            ("added_at", pa.timestamp("us")),
            ("notes", pa.string()),
        ]), 9),
    ])

    # Migration 010: Asset Genealogy
    tables.extend([
        TableDefinition("asset_provenance", pa.schema([
            ("id", pa.string()),
            ("version_id", pa.string()),
            ("creator", pa.string()),
            ("software_used", pa.string()),
            ("software_version", pa.string()),
            ("render_job_id", pa.string()),
            ("pipeline_stage", pa.string()),
            ("vast_storage_path", pa.string()),
            ("vast_element_handle", pa.string()),
            ("source_host", pa.string()),
            ("source_process_id", pa.string()),
            ("created_at", pa.timestamp("us")),
        ]), 10),
        TableDefinition("version_lineage", pa.schema([
            ("id", pa.string()),
            ("ancestor_version_id", pa.string()),
            ("descendant_version_id", pa.string()),
            ("relationship_type", pa.string()),
            ("depth", pa.int32()),
            ("created_at", pa.timestamp("us")),
        ]), 10),
        TableDefinition("asset_dependencies", pa.schema([
            ("id", pa.string()),
            ("source_entity_type", pa.string()),
            ("source_entity_id", pa.string()),
            ("target_entity_type", pa.string()),
            ("target_entity_id", pa.string()),
            ("dependency_type", pa.string()),
            ("dependency_strength", pa.string()),
            ("discovered_by", pa.string()),
            ("discovered_at", pa.timestamp("us")),
        ]), 10),
        TableDefinition("shot_asset_usage", pa.schema([
            ("id", pa.string()),
            ("shot_id", pa.string()),
            ("version_id", pa.string()),
            ("usage_type", pa.string()),
            ("layer_name", pa.string()),
            ("is_active", pa.bool_()),
            ("added_at", pa.timestamp("us")),
            ("removed_at", pa.timestamp("us")),
        ]), 10),
        TableDefinition("storage_metrics", pa.schema([
            ("id", pa.string()),
            ("entity_type", pa.string()),
            ("entity_id", pa.string()),
            ("total_bytes", pa.int64()),
            ("file_count", pa.int32()),
            ("proxy_bytes", pa.int64()),
            ("thumbnail_bytes", pa.int64()),
            ("storage_tier", pa.string()),
            ("measured_at", pa.timestamp("us")),
        ]), 10),
        TableDefinition("render_farm_metrics", pa.schema([
            ("id", pa.string()),
            ("project_id", pa.string()),
            ("shot_id", pa.string()),
            ("version_id", pa.string()),
            ("render_engine", pa.string()),
            ("render_time_seconds", pa.float64()),
            ("core_hours", pa.float64()),
            ("peak_memory_gb", pa.float64()),
            ("frame_count", pa.int32()),
            ("submitted_at", pa.timestamp("us")),
            ("completed_at", pa.timestamp("us")),
        ]), 10),
        TableDefinition("downstream_usage_counts", pa.schema([
            ("entity_type", pa.string()),
            ("entity_id", pa.string()),
            ("direct_dependents", pa.int32()),
            ("transitive_dependents", pa.int32()),
            ("shot_count", pa.int32()),
            ("last_computed_at", pa.timestamp("us")),
        ]), 10),
    ])

    # Migration 011: IAM Tables
    tables.extend([
        TableDefinition("iam_users", pa.schema([
            ("id", pa.string()),
            ("external_id", pa.string()),
            ("email", pa.string()),
            ("display_name", pa.string()),
            ("avatar_url", pa.string()),
            ("status", pa.string()),
            ("password_hash", pa.string()),
            ("auth_method", pa.string()),
            ("must_change_password", pa.bool_()),
            ("created_at", pa.timestamp("us")),
            ("updated_at", pa.timestamp("us")),
        ]), 11),
        TableDefinition("iam_project_memberships", pa.schema([
            ("id", pa.string()),
            ("user_id", pa.string()),
            ("project_id", pa.string()),
            ("tenant_id", pa.string()),
            ("role", pa.string()),
            ("granted_by", pa.string()),
            ("granted_at", pa.timestamp("us")),
        ]), 11),
        TableDefinition("iam_global_roles", pa.schema([
            ("user_id", pa.string()),
            ("role", pa.string()),
            ("granted_by", pa.string()),
            ("granted_at", pa.timestamp("us")),
        ]), 11),
        TableDefinition("iam_api_keys", pa.schema([
            ("id", pa.string()),
            ("key_hash", pa.string()),
            ("key_salt", pa.string()),
            ("owner_id", pa.string()),
            ("label", pa.string()),
            ("scopes", pa.string()),
            ("expires_at", pa.timestamp("us")),
            ("created_at", pa.timestamp("us")),
            ("last_used_at", pa.timestamp("us")),
            ("revoked", pa.bool_()),
        ]), 11),
        TableDefinition("iam_refresh_tokens", pa.schema([
            ("token_hash", pa.string()),
            ("user_id", pa.string()),
            ("expires_at", pa.timestamp("us")),
            ("revoked_at", pa.timestamp("us")),
            ("created_at", pa.timestamp("us")),
        ]), 11),
    ])

    # Migration 012: Audit Trail
    tables.append(
        TableDefinition("auth_decisions", pa.schema([
            ("id", pa.string()),
            ("timestamp", pa.timestamp("us")),
            ("actor_id", pa.string()),
            ("actor_email", pa.string()),
            ("auth_strategy", pa.string()),
            ("permission", pa.string()),
            ("resource_type", pa.string()),
            ("resource_id", pa.string()),
            ("decision", pa.string()),
            ("denial_reason", pa.string()),
            ("shadow_mode", pa.bool_()),
            ("ip_address", pa.string()),
            ("user_agent", pa.string()),
            ("request_method", pa.string()),
            ("request_path", pa.string()),
        ]), 12)
    )

    # Migration 013: Ad-hoc Query Audit
    tables.append(
        TableDefinition("adhoc_query_audit", pa.schema([
            ("id", pa.string()),
            ("user_id", pa.string()),
            ("sql_text", pa.string()),
            ("sql_hash", pa.string()),
            ("row_count", pa.int32()),
            ("duration_ms", pa.int32()),
            ("status", pa.string()),
            ("error_message", pa.string()),
            ("created_at", pa.timestamp("us")),
        ]), 13)
    )

    # Migration 014: Processed Events (override earlier one from migration 6)
    # Only keep the migration 14 version
    tables = [t for t in tables if t.name != "processed_events" or t.migration_version != 6]
    tables.append(
        TableDefinition("processed_events", pa.schema([
            ("event_id", pa.string()),
            ("processed_at", pa.timestamp("us")),
        ]), 14)
    )

    # Migration 015: Processing Requests — tracks on-demand DataEngine function
    # invocations for files that missed the automatic element trigger (e.g. files
    # put into the bucket via s3cmd, NFS copy, or catalog rehydration). Populated
    # by POST /storage/process; read by GET /storage/processing-status. Lets the
    # Storage Browser show "processing" / "failed" states and enforces per-object
    # request dedup via the job_id primary key and an (s3_bucket, s3_key) lookup.
    #
    # In Commit 1 the table is created but unused — the status endpoint reads it
    # optionally and returns null in_flight state. Commit 3 wires the insert path.
    tables.append(
        TableDefinition("processing_requests", pa.schema([
            ("job_id", pa.string()),        # uuid primary key
            ("s3_bucket", pa.string()),
            ("s3_key", pa.string()),
            ("status", pa.string()),        # in_progress | completed | failed | timed_out
            ("requested_at", pa.timestamp("us")),
            ("requested_by", pa.string()),  # user email from JWT
            ("completed_at", pa.timestamp("us")),
            ("error_message", pa.string()),
            ("deadline_at", pa.timestamp("us")),
        ]), 15)
    )

    return tables


def create_tables(
    endpoint: str,
    access_key: str,
    secret_key: str,
    bucket: str,
    schema_name: str,
    dry_run: bool = False,
) -> Tuple[int, int, Optional[str]]:
    """
    Create all SpaceHarbor tables via vastdb SDK.

    Returns:
        Tuple of (tables_created, tables_existing, error_message or None)
    """
    try:
        log_info(f"Connecting to VAST Database: {endpoint}")
        session = vastdb.connect(
            endpoint=endpoint,
            access=access_key,
            secret=secret_key
        )

        tables = get_table_definitions()
        tables_created = 0
        tables_existing = 0

        with session.transaction() as tx:
            log_info(f"Getting bucket: {bucket}")
            bucket_obj = tx.bucket(bucket)

            log_info(f"Getting schema: {schema_name}")
            try:
                schema = bucket_obj.schema(schema_name)
            except Exception:
                log_info(f"Schema {schema_name} does not exist, creating it")
                schema = bucket_obj.create_schema(schema_name)

            # Get list of existing tables to check idempotency
            existing_table_names = set()
            try:
                existing_tables = schema.tables()
                existing_table_names = {t.name for t in existing_tables}
                log_info(f"Found {len(existing_table_names)} existing tables")
            except Exception as e:
                log_info(f"Could not list existing tables: {e}")

            # Create or skip each table
            for table_def in tables:
                if table_def.name in existing_table_names:
                    log_info(f"[SKIP] {table_def.name} (already exists)")
                    tables_existing += 1
                    continue

                if dry_run:
                    log_info(f"[DRY-RUN] Would create {table_def.name}")
                    tables_created += 1
                    continue

                try:
                    log_info(f"Creating table: {table_def.name}")
                    schema.create_table(table_def.name, table_def.schema)
                    tables_created += 1
                    log_info(f"[OK] {table_def.name}")
                except Exception as e:
                    error_msg = str(e)
                    log_error(f"Failed to create {table_def.name}: {error_msg}")
                    return 0, 0, f"Failed to create table {table_def.name}: {error_msg}"

            # Insert schema version record via PyArrow record batch
            if not dry_run and tables_created > 0:
                try:
                    sv_table = schema.table("schema_version")
                    max_version = max(t.migration_version for t in tables)
                    batch = pa.RecordBatch.from_pydict({
                        "version": [max_version],
                        "applied_at": [datetime.utcnow()],
                        "description": [f"vastdb SDK migration: {tables_created} tables created"],
                    }, schema=pa.schema([
                        ("version", pa.int32()),
                        ("applied_at", pa.timestamp("us")),
                        ("description", pa.string()),
                    ]))
                    sv_table.insert(batch)
                    log_info(f"Recorded schema version {max_version}")
                except Exception as e:
                    log_info(f"Could not insert schema version: {e}")

        return tables_created, tables_existing, None

    except Exception as e:
        error_msg = str(e)
        log_error(f"Migration failed: {error_msg}")
        return 0, 0, error_msg


def get_schema_status(
    endpoint: str,
    access_key: str,
    secret_key: str,
    bucket: str,
    schema_name: str,
) -> Dict[str, Any]:
    """
    Query current schema version and return status info.
    Used by the schema-status endpoint to avoid Trino dependency.
    """
    tables = get_table_definitions()
    total_migrations = max(t.migration_version for t in tables)

    try:
        session = vastdb.connect(endpoint=endpoint, access=access_key, secret=secret_key)

        with session.transaction() as tx:
            bucket_obj = tx.bucket(bucket)
            try:
                db_schema = bucket_obj.schema(schema_name)
            except Exception:
                return {
                    "currentVersion": 0,
                    "availableMigrations": total_migrations,
                    "upToDate": False,
                    "tables": [],
                }

            # Read schema_version table for current version
            current_version = 0
            try:
                sv_table = db_schema.table("schema_version")
                reader = sv_table.select(columns=["version"])
                rb = reader.read_all()
                if len(rb) > 0:
                    current_version = max(rb.column("version").to_pylist())
            except Exception:
                pass

            # List existing tables
            existing = []
            try:
                existing = [t.name for t in db_schema.tables()]
            except Exception:
                pass

            return {
                "currentVersion": current_version,
                "availableMigrations": total_migrations,
                "upToDate": current_version >= total_migrations,
                "tables": existing,
            }

    except Exception as e:
        return {
            "currentVersion": 0,
            "availableMigrations": total_migrations,
            "upToDate": False,
            "error": str(e),
        }


def main() -> int:
    parser = argparse.ArgumentParser(
        description="SpaceHarbor VAST Database Migration Tool",
        formatter_class=argparse.RawDescriptionHelpFormatter,
    )
    parser.add_argument(
        "--endpoint",
        help="VAST Database endpoint URL",
    )
    parser.add_argument(
        "--access-key",
        help="S3 access key",
    )
    parser.add_argument(
        "--secret-key",
        help="S3 secret key",
    )
    parser.add_argument(
        "--bucket",
        help="Database bucket name",
    )
    parser.add_argument(
        "--schema",
        help="Schema name",
    )
    parser.add_argument(
        "--dry-run",
        action="store_true",
        help="List tables without creating them",
    )
    parser.add_argument(
        "--status",
        action="store_true",
        help="Query current schema status (no changes)",
    )
    parser.add_argument(
        "--ssl-verify",
        action="store_true",
        help="Enable SSL certificate verification",
    )

    args = parser.parse_args()

    # Load from environment or args
    endpoint = args.endpoint or os.environ.get("VAST_DB_ENDPOINT")
    access_key = args.access_key or os.environ.get("VAST_DB_ACCESS_KEY")
    secret_key = args.secret_key or os.environ.get("VAST_DB_SECRET_KEY")
    bucket = args.bucket or os.environ.get("VAST_DB_BUCKET", "spaceharbor")
    schema_name = args.schema or os.environ.get("VAST_DB_SCHEMA", "spaceharbor")

    # Validate required parameters
    if not endpoint:
        result = {
            "status": "error",
            "message": "VAST_DB_ENDPOINT is required (env var or --endpoint)",
        }
        print(json.dumps(result))
        return 1

    if not access_key:
        result = {
            "status": "error",
            "message": "VAST_DB_ACCESS_KEY is required (env var or --access-key)",
        }
        print(json.dumps(result))
        return 1

    if not secret_key:
        result = {
            "status": "error",
            "message": "VAST_DB_SECRET_KEY is required (env var or --secret-key)",
        }
        print(json.dumps(result))
        return 1

    # Configure SSL
    configure_ssl(args.ssl_verify)

    # Status-only mode: query and return, no changes
    if args.status:
        result = get_schema_status(endpoint, access_key, secret_key, bucket, schema_name)
        print(json.dumps(result))
        return 0

    log_info(f"Starting migration: endpoint={endpoint}, bucket={bucket}, schema={schema_name}")

    if args.dry_run:
        log_info("DRY-RUN mode enabled")

    # Create tables
    tables_created, tables_existing, error = create_tables(
        endpoint=endpoint,
        access_key=access_key,
        secret_key=secret_key,
        bucket=bucket,
        schema_name=schema_name,
        dry_run=args.dry_run,
    )

    # Output JSON result
    if error:
        result = {
            "status": "error",
            "message": error,
        }
        print(json.dumps(result))
        return 1

    result = {
        "status": "ok",
        "message": f"Migration completed: {tables_created} created, {tables_existing} existing",
        "tables_created": tables_created,
        "tables_existing": tables_existing,
    }
    print(json.dumps(result))
    return 0


if __name__ == "__main__":
    import os
    sys.exit(main())
