"""VAST DataEngine function: storage-metrics-collector.

Scheduled daily trigger that iterates VAST S3 bucket prefixes per project,
computes byte counts, and publishes storage.metrics.collected CloudEvent.

Environment variables:
  VAST_S3_ENDPOINT  - VAST S3 endpoint URL (e.g., https://vast-s3.example.com)
  VAST_S3_BUCKET    - S3 bucket name (default: spaceharbor-media)
  VAST_ACCESS_KEY   - S3 access key
  VAST_SECRET_KEY   - S3 secret key
  CONTROL_PLANE_URL - URL of the SpaceHarbor control-plane API
  VAST_PROJECT_ID   - If set, only collect metrics for this project
  KAFKA_BROKER      - Kafka broker address (for shared cloudevent_publisher)
"""

import logging
import os
import sys

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", ".."))
from shared.cloudevent_publisher import publish_completion
from shared.input_validation import InputValidationError, validate_asset_id

logging.basicConfig(level=logging.INFO, format="%(levelname)s %(message)s")
log = logging.getLogger("storage-metrics-collector")

# Media type classification by extension
PROXY_EXTENSIONS = {".mp4", ".mov", ".webm"}
THUMBNAIL_EXTENSIONS = {".jpg", ".jpeg", ".png", ".webp"}


def collect_project_metrics(
    s3_client,
    bucket: str,
    project_prefix: str,
) -> dict:
    """Collect storage metrics for a single project prefix.

    Iterates all objects under the prefix, classifying them as
    proxy, thumbnail, or primary media.

    Returns:
        Dict with total_bytes, file_count, proxy_bytes, thumbnail_bytes.
    """
    total_bytes = 0
    file_count = 0
    proxy_bytes = 0
    thumbnail_bytes = 0

    paginator = s3_client.get_paginator("list_objects_v2")
    for page in paginator.paginate(Bucket=bucket, Prefix=project_prefix):
        for obj in page.get("Contents", []):
            size = obj.get("Size", 0)
            key = obj.get("Key", "").lower()
            total_bytes += size
            file_count += 1

            if any(key.endswith(ext) for ext in PROXY_EXTENSIONS):
                proxy_bytes += size
            elif any(key.endswith(ext) for ext in THUMBNAIL_EXTENSIONS):
                thumbnail_bytes += size

    return {
        "total_bytes": total_bytes,
        "file_count": file_count,
        "proxy_bytes": proxy_bytes,
        "thumbnail_bytes": thumbnail_bytes,
    }


def post_metrics_to_control_plane(
    control_plane_url: str,
    project_id: str,
    metrics: dict,
) -> bool:
    """Post collected metrics to the control-plane storage metrics API."""
    try:
        import requests
    except ImportError:
        log.warning("requests not installed - skipping API call")
        return False

    payload = {
        "entityType": "project",
        "entityId": project_id,
        "totalBytes": metrics["total_bytes"],
        "fileCount": metrics["file_count"],
        "proxyBytes": metrics["proxy_bytes"],
        "thumbnailBytes": metrics["thumbnail_bytes"],
        "storageTier": "hot",
    }
    try:
        resp = requests.post(
            f"{control_plane_url}/api/v1/projects/{project_id}/storage-metrics",
            json=payload,
            timeout=30,
        )
        if resp.status_code in (200, 201):
            return True
        log.warning(f"API returned {resp.status_code}: {resp.text}")
        return False
    except Exception as e:
        log.warning(f"Error posting metrics: {e}")
        return False


def list_project_prefixes(s3_client, bucket: str) -> list[str]:
    """List top-level project prefixes in the S3 bucket.

    Assumes structure: <bucket>/projects/<project-id>/...
    """
    prefixes = []
    try:
        resp = s3_client.list_objects_v2(
            Bucket=bucket,
            Prefix="projects/",
            Delimiter="/",
        )
        for prefix_info in resp.get("CommonPrefixes", []):
            prefix = prefix_info.get("Prefix", "")
            if prefix:
                prefixes.append(prefix)
    except Exception as e:
        log.warning(f"Failed to list project prefixes: {e}")
    return prefixes


def extract_project_id_from_prefix(prefix: str) -> str:
    """Extract project ID from prefix like 'projects/<id>/'."""
    parts = prefix.strip("/").split("/")
    return parts[-1] if len(parts) >= 2 else prefix.strip("/")


def main() -> int:
    bucket = os.environ.get("VAST_S3_BUCKET", "spaceharbor-media")
    s3_endpoint = os.environ.get("VAST_S3_ENDPOINT", "")
    access_key = os.environ.get("VAST_ACCESS_KEY", "")
    secret_key = os.environ.get("VAST_SECRET_KEY", "")
    control_plane_url = os.environ.get("CONTROL_PLANE_URL", "http://localhost:3000")
    target_project_id = os.environ.get("VAST_PROJECT_ID", "")

    log.info(f"Starting storage metrics collection for bucket: {bucket}")

    try:
        import boto3
        from botocore.config import Config as BotoConfig
    except ImportError:
        log.error("boto3 not installed - cannot access S3")
        return 1

    s3_client = boto3.client(
        "s3",
        endpoint_url=s3_endpoint or None,
        aws_access_key_id=access_key or None,
        aws_secret_access_key=secret_key or None,
        config=BotoConfig(s3={"addressing_style": "path"}),  # VAST requires path-style
    )

    if target_project_id:
        prefixes = [f"projects/{target_project_id}/"]
    else:
        prefixes = list_project_prefixes(s3_client, bucket)

    if not prefixes:
        log.info("No project prefixes found - nothing to collect")
        publish_completion(
            function_name="storage-metrics-collector",
            asset_id="system",
            success=True,
            metadata={"projects_collected": 0},
        )
        return 0

    results = []
    for prefix in prefixes:
        project_id = extract_project_id_from_prefix(prefix)
        log.info(f"Collecting metrics for project {project_id} ({prefix})")

        metrics = collect_project_metrics(s3_client, bucket, prefix)
        log.info(
            f"  {project_id}: {metrics['file_count']} files, "
            f"{metrics['total_bytes']} bytes total, "
            f"{metrics['proxy_bytes']} proxy, "
            f"{metrics['thumbnail_bytes']} thumbnail"
        )

        posted = post_metrics_to_control_plane(control_plane_url, project_id, metrics)
        results.append({
            "project_id": project_id,
            "metrics": metrics,
            "posted": posted,
        })

    publish_completion(
        function_name="storage-metrics-collector",
        asset_id="system",
        success=True,
        metadata={
            "projects_collected": len(results),
            "total_bytes_all": sum(r["metrics"]["total_bytes"] for r in results),
            "total_files_all": sum(r["metrics"]["file_count"] for r in results),
        },
    )

    log.info(f"Storage metrics collection complete: {len(results)} projects")
    return 0


if __name__ == "__main__":
    sys.exit(main())
