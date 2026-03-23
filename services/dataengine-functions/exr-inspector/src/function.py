"""VAST DataEngine entrypoint for exr-inspector.

Called by VAST DataEngine when an EXR file is uploaded or modified.

Environment variables:
  VAST_SOURCE_PATH  - NFS path to the .exr file (set by DataEngine)
  VAST_ASSET_ID     - SpaceHarbor asset ID (set by DataEngine pipeline config)
  VAST_PROJECT_ID   - SpaceHarbor project ID for hierarchy association (optional)
  VAST_SHOT_ID      - SpaceHarbor shot ID for hierarchy association (optional)
  KAFKA_BROKER      - Kafka broker address (optional; skips publish if unset)
"""

import logging
import os
import sys

from src.inspector import extract_exr_metadata, ExrInspectorError

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", ".."))
from shared.cloudevent_publisher import publish_completion
from shared.s3_tagging import tag_s3_object, extract_s3_key_from_path
from shared.input_validation import (
    InputValidationError,
    validate_asset_id,
    validate_media_path,
)

logging.basicConfig(level=logging.INFO, format="%(levelname)s %(message)s")
log = logging.getLogger("exr-inspector")


def detect_multipart_exr_sizes(source_path: str) -> int | None:
    """Detect if an EXR file is part of a multi-part set and sum total sizes.

    Multi-part EXR files may have companion parts with naming conventions:
    - render.exr, render.part2.exr, render.part3.exr
    - render_left.exr, render_right.exr (stereo)
    - render.beauty.exr, render.diffuse.exr (AOV layers)

    Returns total bytes across all parts, or None if single file.
    """
    from pathlib import Path
    import re

    path = Path(source_path)
    if not path.exists():
        return None

    directory = path.parent
    stem = path.stem
    # Strip any part/layer suffix to find the base name
    base = re.sub(r"[._](part\d+|left|right|beauty|diffuse|specular|sss|emission|coat)$", "", stem, flags=re.IGNORECASE)

    # Find all related EXR files in the same directory
    related = []
    for f in directory.glob("*.exr"):
        f_base = re.sub(r"[._](part\d+|left|right|beauty|diffuse|specular|sss|emission|coat)$", "", f.stem, flags=re.IGNORECASE)
        if f_base == base:
            related.append(f)

    if len(related) <= 1:
        return None

    total = sum(f.stat().st_size for f in related if f.exists())
    return total


def main() -> int:
    source_path = os.environ.get("VAST_SOURCE_PATH", "")
    asset_id = os.environ.get("VAST_ASSET_ID", "")
    project_id = os.environ.get("VAST_PROJECT_ID", "")
    shot_id = os.environ.get("VAST_SHOT_ID", "")

    log.info(f"Inspecting EXR asset {asset_id}: {source_path}")

    if not source_path or not asset_id:
        log.error("VAST_SOURCE_PATH and VAST_ASSET_ID must be set")
        return 1

    # Validate inputs to prevent path traversal and injection
    try:
        validate_asset_id(asset_id)
        validate_media_path(source_path, label="Source path")
    except InputValidationError as e:
        log.error(f"Input validation failed: {e}")
        return 1

    try:
        metadata = extract_exr_metadata(source_path)
        log.info(f"Extracted: {metadata['resolution']}")
        # Include hierarchy association for provenance tracking (Phase C)
        if project_id:
            metadata["project_id"] = project_id
        if shot_id:
            metadata["shot_id"] = shot_id
        # C.9: Promote vast_storage_path and file_size_bytes to top-level
        # CloudEvent data fields for easy access by control-plane handlers
        metadata["vast_storage_path"] = metadata.get("vast_storage_path", source_path)
        metadata["file_size_bytes"] = metadata.get("file_size_bytes", 0)
        # C.9: Multi-part EXR validation — sum sizes across all parts
        multipart_total = detect_multipart_exr_sizes(source_path)
        if multipart_total is not None:
            metadata["multipart_total_bytes"] = multipart_total
            metadata["is_multipart"] = True
            log.info(f"Multi-part EXR total: {multipart_total} bytes")
        publish_completion(
            function_name="exr_inspector",
            asset_id=asset_id,
            success=True,
            metadata=metadata,
        )
        # C.10: Write S3 tags for VAST Catalog integration (best-effort)
        s3_key = extract_s3_key_from_path(source_path)
        if s3_key:
            tag_s3_object(
                s3_key, asset_id, "metadata-extracted",
                project_id=project_id, media_type="image",
            )
        return 0
    except ExrInspectorError as e:
        log.error(f"Inspection failed: {e}")
        publish_completion(
            function_name="exr_inspector",
            asset_id=asset_id,
            success=False,
            error=str(e),
        )
        return 1
    except Exception as e:
        log.error(f"Unexpected error: {e}", exc_info=True)
        publish_completion(
            function_name="exr_inspector",
            asset_id=asset_id,
            success=False,
            error=str(e),
        )
        return 1


if __name__ == "__main__":
    sys.exit(main())
