"""VAST DataEngine entrypoint for oiio-proxy-generator.

Called by VAST DataEngine when an ElementCreated event fires
on *.exr or *.dpx files in a monitored VAST view.

Environment variables:
  VAST_SOURCE_PATH  - NFS path to the new file (set by DataEngine)
  VAST_ASSET_ID     - AssetHarbor asset ID (set by DataEngine pipeline config)
  VAST_THUMB_PATH   - NFS path to write thumbnail output
  VAST_PROXY_PATH   - NFS path to write proxy output
  KAFKA_BROKER      - Kafka broker address (default: vastbroker:9092)
  KAFKA_TOPIC       - Kafka topic for completion events (default: assetharbor.proxy)
  DEV_MODE          - If "true", skip VAST I/O and use local test files
  OCIO_CONFIG_PATH  - Path to OCIO config file (default: ACES 1.3 system path)
"""
import os
import sys
import logging

from src.oiio_processor import OiioProcessor
from src.ocio_transform import OcioTransform
from src.publisher import publish_proxy_generated

logging.basicConfig(level=logging.INFO, format="%(levelname)s %(message)s")
log = logging.getLogger("oiio-proxy-generator")


def main() -> int:
    source_path = os.environ.get("VAST_SOURCE_PATH", "")
    asset_id = os.environ.get("VAST_ASSET_ID", "")
    thumb_path = os.environ.get("VAST_THUMB_PATH", f"/tmp/{asset_id}_thumb.jpg")
    proxy_path = os.environ.get("VAST_PROXY_PATH", f"/tmp/{asset_id}_proxy.mp4")

    log.info(f"Processing asset {asset_id}: {source_path}")

    if not source_path or not asset_id:
        log.error("VAST_SOURCE_PATH and VAST_ASSET_ID must be set")
        return 1

    processor = OiioProcessor()
    transform = OcioTransform(config_path=os.environ.get("OCIO_CONFIG_PATH"))

    # Step 1: OCIO — color transform to sRGB for thumbnail
    transformed_for_thumb = transform.apply(source_path, target_colorspace="sRGB")

    # Step 2: OIIO — generate thumbnail (sRGB already applied)
    processor.generate_thumbnail(transformed_for_thumb, thumb_path, width=256, height=256)

    # Step 3: OCIO — Rec.709 transform for proxy review
    transformed_for_proxy = transform.apply(source_path, target_colorspace="Rec.709")

    # Step 4: OIIO — generate proxy (Rec.709 applied)
    processor.generate_proxy(transformed_for_proxy, proxy_path, width=1920, height=1080)

    # Step 5: Publish completion event
    publish_proxy_generated(
        asset_id=asset_id,
        thumbnail_uri=thumb_path,
        proxy_uri=proxy_path,
    )

    log.info(f"Done: thumb={thumb_path} proxy={proxy_path}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
