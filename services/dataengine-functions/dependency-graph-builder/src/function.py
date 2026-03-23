"""VAST DataEngine function: dependency-graph-builder.

Triggered by mtlx-parser completion CloudEvent. Constructs asset_dependencies
records linking materials to textures, and cross-references shots via
shot_asset_usage.

Environment variables:
  MTLX_PARSE_RESULT  - JSON string of mtlx-parser metadata output (standalone mode)
  PREVIOUS_RESULT    - JSON string set by DataEngine from the chained CloudEvent's
                       data.previousResult field (chain mode, set by ChainOrchestrator).
                       Takes precedence if MTLX_PARSE_RESULT is not set.
  VAST_ASSET_ID      - SpaceHarbor asset ID
  VAST_PROJECT_ID    - SpaceHarbor project ID (optional, for hierarchy association)
  VAST_SHOT_ID       - SpaceHarbor shot ID (optional, for shot usage linkage)
  CONTROL_PLANE_URL  - URL of the SpaceHarbor control-plane API
  KAFKA_BROKER       - Kafka broker address (for shared cloudevent_publisher)
"""

import json
import logging
import os
import sys

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", ".."))
from shared.cloudevent_publisher import publish_completion

logging.basicConfig(level=logging.INFO, format="%(levelname)s %(message)s")
log = logging.getLogger("dependency-graph-builder")


def build_dependencies(parse_result: dict) -> list[dict]:
    """Build dependency records from mtlx-parser output.

    Args:
        parse_result: Dict with keys: material_name, textures[], looks[], etc.

    Returns:
        List of dependency edge dicts ready for control-plane API.
    """
    dependencies: list[dict] = []

    textures = parse_result.get("textures", [])
    for tex in textures:
        texture_path = tex.get("texture_path", "")
        if not texture_path:
            continue

        dependencies.append({
            "sourceEntityType": "material_version",
            "targetEntityType": "texture",
            "targetEntityId": texture_path,
            "dependencyType": "references_texture",
            "dependencyStrength": "hard",
            "discoveredBy": "dependency-graph-builder",
            "textureType": tex.get("texture_type", "unknown"),
            "colorspace": tex.get("colorspace", "raw"),
            "contentHash": tex.get("content_hash"),
            "dependencyDepth": tex.get("dependency_depth", 0),
        })

    return dependencies


def post_dependencies_to_control_plane(
    control_plane_url: str,
    material_version_id: str,
    dependencies: list[dict],
) -> int:
    """Post dependency records to the control-plane API.

    Returns number of successfully created dependencies.
    """
    try:
        import requests
    except ImportError:
        log.warning("requests not installed — skipping API calls")
        return 0

    created = 0
    for dep in dependencies:
        payload = {
            "sourceEntityType": dep["sourceEntityType"],
            "sourceEntityId": material_version_id,
            "targetEntityType": dep["targetEntityType"],
            "targetEntityId": dep["targetEntityId"],
            "dependencyType": dep["dependencyType"],
            "dependencyStrength": dep["dependencyStrength"],
            "discoveredBy": dep.get("discoveredBy", "dependency-graph-builder"),
        }
        try:
            resp = requests.post(
                f"{control_plane_url}/api/v1/dependencies",
                json=payload,
                timeout=10,
            )
            if resp.status_code == 201:
                created += 1
            else:
                log.warning(f"Failed to create dependency: {resp.status_code} {resp.text}")
        except Exception as e:
            log.warning(f"Error posting dependency: {e}")

    return created


def main() -> int:
    asset_id = os.environ.get("VAST_ASSET_ID", "")
    control_plane_url = os.environ.get("CONTROL_PLANE_URL", "http://localhost:3000")
    project_id = os.environ.get("VAST_PROJECT_ID", "")
    shot_id = os.environ.get("VAST_SHOT_ID", "")

    # Resolve parse result: standalone mode uses MTLX_PARSE_RESULT; chain mode
    # uses PREVIOUS_RESULT (set by DataEngine from the chained CloudEvent payload).
    parse_result_json = os.environ.get("MTLX_PARSE_RESULT", "") or os.environ.get("PREVIOUS_RESULT", "")

    if not asset_id:
        log.error("VAST_ASSET_ID must be set")
        return 1

    if not parse_result_json:
        log.error(
            "No parse result available. Set MTLX_PARSE_RESULT (standalone) "
            "or PREVIOUS_RESULT (chain mode, populated by DataEngine from ChainOrchestrator)."
        )
        return 1

    try:
        parse_result = json.loads(parse_result_json)
    except json.JSONDecodeError as e:
        log.error(f"Invalid MTLX_PARSE_RESULT JSON: {e}")
        return 1

    log.info(f"Building dependency graph for asset {asset_id}")

    dependencies = build_dependencies(parse_result)
    log.info(f"Found {len(dependencies)} dependencies")

    material_version_id = parse_result.get("material_version_id", asset_id)
    created = post_dependencies_to_control_plane(
        control_plane_url, material_version_id, dependencies
    )
    log.info(f"Created {created}/{len(dependencies)} dependency records")

    # If shot_id is provided, create shot-asset usage linkage
    if shot_id:
        try:
            import requests

            requests.post(
                f"{control_plane_url}/api/v1/shots/{shot_id}/asset-usage",
                json={
                    "versionId": material_version_id,
                    "usageType": "lighting_ref",
                    "isActive": True,
                },
                timeout=10,
            )
            log.info(f"Linked material version {material_version_id} to shot {shot_id}")
        except Exception as e:
            log.warning(f"Failed to create shot usage: {e}")

    publish_completion(
        function_name="dependency-graph-builder",
        asset_id=asset_id,
        success=True,
        metadata={
            "dependency_count": len(dependencies),
            "created_count": created,
            "material_name": parse_result.get("material_name", ""),
            "project_id": project_id,
            "shot_id": shot_id,
        },
    )

    return 0


if __name__ == "__main__":
    sys.exit(main())
