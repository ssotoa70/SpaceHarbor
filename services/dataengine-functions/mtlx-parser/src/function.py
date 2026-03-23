"""VAST DataEngine entrypoint for mtlx-parser.

Called by VAST DataEngine when a MaterialX file is uploaded or modified.

Environment variables:
  VAST_SOURCE_PATH  - NFS path to the .mtlx file (set by DataEngine)
  VAST_ASSET_ID     - SpaceHarbor asset ID (set by DataEngine pipeline config)
  VAST_PROJECT_ID   - SpaceHarbor project ID for hierarchy association (optional)
  VAST_SHOT_ID      - SpaceHarbor shot ID for hierarchy association (optional)
  KAFKA_BROKER      - Kafka broker address (for shared cloudevent_publisher)
  DEV_MODE          - If "true", skip Kafka publishing
"""

import logging
import os
import sys

from src.parser import parse_mtlx

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", ".."))
from shared.cloudevent_publisher import publish_completion
from shared.s3_tagging import tag_s3_object, extract_s3_key_from_path

logging.basicConfig(level=logging.INFO, format="%(levelname)s %(message)s")
log = logging.getLogger("mtlx-parser")


def main() -> int:
    source_path = os.environ.get("VAST_SOURCE_PATH", "")
    asset_id = os.environ.get("VAST_ASSET_ID", "")
    project_id = os.environ.get("VAST_PROJECT_ID", "")
    shot_id = os.environ.get("VAST_SHOT_ID", "")

    log.info(f"Processing MaterialX asset {asset_id}: {source_path}")

    if not source_path or not asset_id:
        log.error("VAST_SOURCE_PATH and VAST_ASSET_ID must be set")
        return 1

    try:
        result = parse_mtlx(source_path)
        log.info(f"Parsed: {result['material_name']}")
        # Include hierarchy association for provenance/dependency tracking (Phase C)
        if project_id:
            result["project_id"] = project_id
        if shot_id:
            result["shot_id"] = shot_id
        publish_completion(
            function_name="mtlx-parser",
            asset_id=asset_id,
            success=True,
            metadata=result,
        )
        # C.10: Write S3 tags for VAST Catalog integration (best-effort)
        s3_key = extract_s3_key_from_path(source_path)
        if s3_key:
            tag_s3_object(
                s3_key, asset_id, "metadata-extracted",
                project_id=project_id, media_type="material",
            )
        return 0
    except FileNotFoundError as e:
        log.error(f"File not found: {e}")
        publish_completion(
            function_name="mtlx-parser",
            asset_id=asset_id,
            success=False,
            error=str(e),
        )
        return 1
    except ImportError as e:
        log.error(f"Missing dependency: {e}")
        return 1
    except Exception as e:
        log.error(f"Parsing failed: {e}", exc_info=True)
        publish_completion(
            function_name="mtlx-parser",
            asset_id=asset_id,
            success=False,
            error=str(e),
        )
        return 1


if __name__ == "__main__":
    sys.exit(main())
