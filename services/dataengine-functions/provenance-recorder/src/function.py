"""VAST DataEngine entrypoint for provenance-recorder.

Triggered by VAST DataEngine on ElementCreated events when media files
are uploaded or created. Extracts provenance metadata (creator, software,
render origin) and publishes a provenance.recorded CloudEvent.

Environment variables:
  VAST_SOURCE_PATH  - NFS path to the file (set by DataEngine)
  VAST_ASSET_ID     - SpaceHarbor asset ID (set by DataEngine pipeline config)
  VAST_PROJECT_ID   - SpaceHarbor project ID for hierarchy association (optional)
  VAST_SHOT_ID      - SpaceHarbor shot ID for hierarchy association (optional)
  KAFKA_BROKER      - Kafka broker address (optional; skips publish if unset)
"""

import logging
import os
import sys

from src.recorder import extract_provenance, ProvenanceRecorderError

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", ".."))
from shared.cloudevent_publisher import publish_completion
from shared.input_validation import (
    InputValidationError,
    validate_asset_id,
    validate_media_path,
)

logging.basicConfig(level=logging.INFO, format="%(levelname)s %(message)s")
log = logging.getLogger("provenance-recorder")


def main() -> int:
    source_path = os.environ.get("VAST_SOURCE_PATH", "")
    asset_id = os.environ.get("VAST_ASSET_ID", "")
    project_id = os.environ.get("VAST_PROJECT_ID", "")
    shot_id = os.environ.get("VAST_SHOT_ID", "")

    log.info(f"Recording provenance for asset {asset_id}: {source_path}")

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
        provenance = extract_provenance(source_path)
        log.info(
            f"Extracted provenance: software={provenance.get('software', 'unknown')}, "
            f"creator={provenance.get('creator', 'unknown')}"
        )

        # Include hierarchy association for downstream handlers
        if project_id:
            provenance["project_id"] = project_id
        if shot_id:
            provenance["shot_id"] = shot_id

        publish_completion(
            function_name="provenance_recorder",
            asset_id=asset_id,
            success=True,
            metadata=provenance,
        )
        return 0

    except ProvenanceRecorderError as e:
        log.error(f"Provenance extraction failed: {e}")
        publish_completion(
            function_name="provenance_recorder",
            asset_id=asset_id,
            success=False,
            error=str(e),
        )
        return 1

    except Exception as e:
        log.error(f"Unexpected error: {e}", exc_info=True)
        publish_completion(
            function_name="provenance_recorder",
            asset_id=asset_id,
            success=False,
            error=str(e),
        )
        return 1


if __name__ == "__main__":
    sys.exit(main())
