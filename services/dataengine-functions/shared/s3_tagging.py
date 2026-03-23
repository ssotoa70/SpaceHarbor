"""Shared S3 tagging utilities for VAST Catalog integration.

Provides functions to write SpaceHarbor S3 object tags at processing time,
enabling VAST Catalog discovery of derived outputs (proxies, thumbnails).

The tag vocabulary is defined in the control-plane at
`src/integrations/vast-catalog.ts` and must stay in sync.

Environment variables:
  SPACEHARBOR_S3_ENDPOINT    - S3-compatible endpoint (VAST S3 gateway)
  SPACEHARBOR_S3_REGION      - AWS region (default: us-east-1)
  SPACEHARBOR_S3_BUCKET      - Target bucket name
  SPACEHARBOR_S3_ACCESS_KEY_ID     - Access key
  SPACEHARBOR_S3_SECRET_ACCESS_KEY - Secret key
"""

import logging
import os
from datetime import datetime, timezone

log = logging.getLogger(__name__)

# S3 tag key constants — must match control-plane CATALOG_TAGS
TAG_PROJECT_ID = "ah-project-id"
TAG_ASSET_ID = "ah-asset-id"
TAG_VERSION_ID = "ah-version-id"
TAG_MEDIA_TYPE = "ah-media-type"
TAG_PIPELINE_STAGE = "ah-pipeline-stage"
TAG_INGEST_TIMESTAMP = "ah-ingest-timestamp"

try:
    import boto3
    from botocore.config import Config as BotoConfig
except ImportError:
    boto3 = None  # type: ignore[assignment]
    BotoConfig = None  # type: ignore[assignment,misc]


def _get_s3_client():
    """Create an S3 client from environment variables. Returns None if not configured."""
    if boto3 is None:
        return None

    endpoint = os.environ.get("SPACEHARBOR_S3_ENDPOINT")
    access_key = os.environ.get("SPACEHARBOR_S3_ACCESS_KEY_ID")
    secret_key = os.environ.get("SPACEHARBOR_S3_SECRET_ACCESS_KEY")
    region = os.environ.get("SPACEHARBOR_S3_REGION", "us-east-1")

    if not endpoint or not access_key or not secret_key:
        return None

    return boto3.client(
        "s3",
        endpoint_url=endpoint,
        aws_access_key_id=access_key,
        aws_secret_access_key=secret_key,
        region_name=region,
        config=BotoConfig(s3={"addressing_style": "path"}),  # VAST requires path-style
    )


def _get_bucket() -> str:
    return os.environ.get("SPACEHARBOR_S3_BUCKET", "spaceharbor")


def tag_s3_object(
    s3_key: str,
    asset_id: str,
    pipeline_stage: str,
    *,
    project_id: str = "",
    version_id: str = "",
    media_type: str = "",
) -> bool:
    """Write SpaceHarbor S3 tags to an object for VAST Catalog integration.

    Args:
        s3_key: The S3 object key to tag.
        asset_id: SpaceHarbor asset ID.
        pipeline_stage: Current pipeline stage (e.g., "proxy-generated", "metadata-extracted").
        project_id: Optional project ID.
        version_id: Optional version ID.
        media_type: Optional media type classification.

    Returns:
        True if tags were written successfully, False otherwise.
    """
    client = _get_s3_client()
    if client is None:
        log.debug("S3 tagging skipped: S3 not configured or boto3 not installed")
        return False

    tags = {
        TAG_ASSET_ID: asset_id,
        TAG_PIPELINE_STAGE: pipeline_stage,
        TAG_INGEST_TIMESTAMP: datetime.now(timezone.utc).isoformat(),
    }
    if project_id:
        tags[TAG_PROJECT_ID] = project_id
    if version_id:
        tags[TAG_VERSION_ID] = version_id
    if media_type:
        tags[TAG_MEDIA_TYPE] = media_type

    tag_set = [{"Key": k, "Value": v} for k, v in tags.items()]

    try:
        client.put_object_tagging(
            Bucket=_get_bucket(),
            Key=s3_key,
            Tagging={"TagSet": tag_set},
        )
        log.info(f"S3 tags written for {s3_key}: stage={pipeline_stage}")
        return True
    except Exception as e:
        log.warning(f"Failed to write S3 tags for {s3_key}: {e}")
        return False


def extract_s3_key_from_path(vast_path: str) -> str | None:
    """Extract an S3 key from a VAST NFS or S3 path.

    Handles paths like:
      /data/media/project/file.exr -> project/file.exr
      vast://bucket/key -> key
      s3://bucket/key -> key

    Returns None if the path cannot be parsed.
    """
    if not vast_path:
        return None

    # Strip vast:// or s3:// prefix
    for prefix in ("vast://", "s3://"):
        if vast_path.startswith(prefix):
            remainder = vast_path[len(prefix):]
            # Skip bucket name
            slash_idx = remainder.find("/")
            if slash_idx >= 0:
                return remainder[slash_idx + 1:]
            return None

    # NFS path: strip common base prefixes
    base_dir = os.environ.get("SPACEHARBOR_MEDIA_BASE_DIR", "/data/media")
    if vast_path.startswith(base_dir):
        return vast_path[len(base_dir):].lstrip("/")

    return None
