"""VAST DataEngine entrypoint for oiio-proxy-generator.

Called by VAST DataEngine when an ElementCreated event fires
on *.exr or *.dpx files in a monitored VAST view.

Environment variables:
  VAST_SOURCE_PATH  - NFS path to the new file (set by DataEngine)
  VAST_ASSET_ID     - SpaceHarbor asset ID (set by DataEngine pipeline config)
  VAST_PROJECT_ID   - SpaceHarbor project ID for hierarchy association (optional)
  VAST_SHOT_ID      - SpaceHarbor shot ID for hierarchy association (optional)
  VAST_THUMB_PATH   - NFS path to write thumbnail output
  VAST_PROXY_PATH   - NFS path to write proxy output
  KAFKA_BROKER      - Kafka broker address (default: vastbroker:9092)
  KAFKA_TOPIC       - Kafka topic for completion events (default: spaceharbor.proxy)
  DEV_MODE          - If "true", skip VAST I/O and use local test files
  OCIO_CONFIG_PATH  - Path to OCIO config file (default: ACES 1.3 system path)
"""
import os
import sys
import logging

from src.oiio_processor import OiioProcessor
from src.ocio_transform import OcioTransform
from src.publisher import publish_proxy_generated
from src.exr_inspector import extract_exr_metadata, ExrInspectorError

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", ".."))
from shared.s3_tagging import tag_s3_object, extract_s3_key_from_path
from shared.input_validation import (
    InputValidationError,
    validate_asset_id,
    validate_media_path,
)

logging.basicConfig(level=logging.INFO, format="%(levelname)s %(message)s")
log = logging.getLogger("oiio-proxy-generator")


def main() -> int:
    source_path = os.environ.get("VAST_SOURCE_PATH", "")
    asset_id = os.environ.get("VAST_ASSET_ID", "")
    project_id = os.environ.get("VAST_PROJECT_ID", "")
    shot_id = os.environ.get("VAST_SHOT_ID", "")
    thumb_path = os.environ.get("VAST_THUMB_PATH", f"/tmp/{asset_id}_thumb.jpg")
    proxy_path = os.environ.get("VAST_PROXY_PATH", f"/tmp/{asset_id}_proxy.mp4")

    log.info(f"Processing asset {asset_id}: {source_path}")

    if not source_path or not asset_id:
        log.error("VAST_SOURCE_PATH and VAST_ASSET_ID must be set")
        return 1

    # Validate inputs to prevent path traversal and injection
    try:
        validate_asset_id(asset_id)
        validate_media_path(source_path, label="Source path")
        validate_media_path(thumb_path, label="Thumbnail path")
        validate_media_path(proxy_path, label="Proxy path")
    except InputValidationError as e:
        log.error(f"Input validation failed: {e}")
        return 1

    dev_mode = os.environ.get("DEV_MODE", "false").lower() == "true"
    processor = OiioProcessor()
    transform = OcioTransform(config_path=os.environ.get("OCIO_CONFIG_PATH"), dev_mode=dev_mode)

    # Step 0: Extract EXR metadata if applicable
    exr_metadata = None
    if source_path.lower().endswith(".exr"):
        try:
            exr_metadata = extract_exr_metadata(source_path)
            log.info(f"EXR metadata extracted: {exr_metadata.get('resolution')}")
        except ExrInspectorError as e:
            log.warning(f"Failed to extract EXR metadata: {e}")

    # Step 1: OCIO — color transform to sRGB for thumbnail
    transformed_for_thumb = transform.apply(source_path, target_colorspace="sRGB")

    # Step 2: OIIO — generate thumbnail (sRGB already applied)
    processor.generate_thumbnail(transformed_for_thumb, thumb_path, width=256, height=256)

    # Step 3: OCIO — Rec.709 transform for proxy review
    transformed_for_proxy = transform.apply(source_path, target_colorspace="Rec.709")

    # Step 4: OIIO — generate proxy (Rec.709 applied)
    processor.generate_proxy(transformed_for_proxy, proxy_path, width=1920, height=1080)

    # Step 5: Measure output file sizes for storage metrics (Phase C.9)
    from pathlib import Path

    thumb_size = Path(thumb_path).stat().st_size if Path(thumb_path).exists() else 0
    proxy_size = Path(proxy_path).stat().st_size if Path(proxy_path).exists() else 0
    source_size = Path(source_path).stat().st_size if Path(source_path).exists() else 0

    # Step 6: Publish completion event with file sizes
    publish_proxy_generated(
        asset_id=asset_id,
        thumbnail_uri=thumb_path,
        proxy_uri=proxy_path,
        thumbnail_size_bytes=thumb_size,
        proxy_size_bytes=proxy_size,
        source_size_bytes=source_size,
        project_id=project_id,
        shot_id=shot_id,
    )

    # C.10: Write S3 tags to derived outputs for VAST Catalog integration
    for derived_path, derived_type in [(thumb_path, "thumbnail"), (proxy_path, "proxy")]:
        s3_key = extract_s3_key_from_path(derived_path)
        if s3_key:
            tag_s3_object(
                s3_key, asset_id, "proxy-generated",
                project_id=project_id, media_type=derived_type,
            )

    log.info(
        f"Done: thumb={thumb_path} ({thumb_size}B) "
        f"proxy={proxy_path} ({proxy_size}B)"
    )
    return 0


if __name__ == "__main__":
    sys.exit(main())
