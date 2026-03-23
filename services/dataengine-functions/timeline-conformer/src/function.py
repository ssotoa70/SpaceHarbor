"""VAST DataEngine function: timeline-conformer.

Triggered by otio-parser completion CloudEvent. Matches clip shot_name
against the SpaceHarbor hierarchy and updates conform status.

Publishes `timeline.conform.completed` CloudEvent on success.

Environment variables:
  OTIO_PARSE_RESULT   - JSON string of otio-parser metadata output (standalone mode)
  PREVIOUS_RESULT     - JSON string set by DataEngine from the chained CloudEvent's
                        data.previousResult field (chain mode, set by ChainOrchestrator).
                        Takes precedence if OTIO_PARSE_RESULT is not set.
  VAST_ASSET_ID       - SpaceHarbor asset ID
  VAST_PROJECT_ID     - SpaceHarbor project ID (required for hierarchy lookup)
  VAST_SHOT_ID        - SpaceHarbor shot ID (optional)
  CONTROL_PLANE_URL   - URL of the SpaceHarbor control-plane API
  KAFKA_BROKER        - Kafka broker address (for shared cloudevent_publisher)
"""

import json
import logging
import os
import re
import sys

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", ".."))
from shared.cloudevent_publisher import publish_completion

logging.basicConfig(level=logging.INFO, format="%(levelname)s %(message)s")
log = logging.getLogger("timeline-conformer")

# Regex to extract shot name from clip name.
# Supports both combined format (SEQ010_SH020) and single segment (SH040)
# - Combined: SEQ010_SH020_comp_v003 -> SEQ010_SH020
# - Single: SH040_final or sh040 -> SH040 or sh040
SHOT_PATTERN = re.compile(
    r"(?:^|[_\-])"
    r"(?:"
    r"([A-Z]{2,4}\d{2,4}[_\-][A-Z]{2,4}\d{2,4})"  # SEQ010_SH020 format
    r"|"
    r"((?:SH|sh|shot)[_]?\d{3,4})"  # SH040 or sh040 format
    r")",
    re.IGNORECASE,
)


def extract_shot_name(clip_name: str) -> str | None:
    """Extract a shot identifier from a clip name.

    Supports patterns like:
      - SQ010_SH020_comp_v003 -> SQ010_SH020 (combined format)
      - seq010-sh020 -> seq010-sh020 (combined format, case-insensitive)
      - myshow_SQ010_SH020 -> SQ010_SH020 (combined with prefix)
      - SH040 -> SH040 (single segment from otio-parser)
      - sh040_v001 -> sh040 (single segment, case-insensitive)
    """
    match = SHOT_PATTERN.search(clip_name)
    if not match:
        return None
    # Group 1: combined SEQ010_SH020 format
    # Group 2: single segment SH040 format
    return match.group(1) if match.group(1) else match.group(2)


def conform_clips(
    clips: list[dict],
    hierarchy_shots: dict[str, dict],
) -> list[dict]:
    """Match clip names against hierarchy shots.

    Args:
        clips: List of clip dicts from otio-parser output.
        hierarchy_shots: Map of shot code -> shot info from hierarchy API.

    Returns:
        List of conform result dicts with shotId and conformStatus.
    """
    results: list[dict] = []

    for clip in clips:
        clip_name = clip.get("clip_name", clip.get("clipName", ""))
        shot_name = extract_shot_name(clip_name)

        conform_result = {
            "clipName": clip_name,
            "extractedShotName": shot_name,
            "conformStatus": "unmatched",
            "shotId": None,
        }

        if shot_name:
            # Try exact match first, then case-insensitive
            shot_info = hierarchy_shots.get(shot_name)
            if not shot_info:
                shot_info = hierarchy_shots.get(shot_name.upper())
            if not shot_info:
                shot_info = hierarchy_shots.get(shot_name.lower())

            if shot_info:
                conform_result["conformStatus"] = "matched"
                conform_result["shotId"] = shot_info.get("id")

        results.append(conform_result)

    return results


def fetch_hierarchy_shots(
    control_plane_url: str,
    project_id: str,
) -> dict[str, dict]:
    """Fetch shots from hierarchy API, keyed by shot code."""
    try:
        import requests

        resp = requests.get(
            f"{control_plane_url}/api/v1/hierarchy",
            params={"projectId": project_id},
            timeout=15,
        )
        if resp.status_code != 200:
            log.warning(f"Hierarchy API returned {resp.status_code}")
            return {}

        data = resp.json()
        shots: dict[str, dict] = {}
        # Walk hierarchy tree to find all shots
        for project in data.get("projects", []):
            for seq in project.get("sequences", project.get("children", [])):
                for shot in seq.get("shots", seq.get("children", [])):
                    code = shot.get("code", shot.get("name", ""))
                    if code:
                        shots[code] = shot
        return shots
    except Exception as e:
        log.warning(f"Failed to fetch hierarchy: {e}")
        return {}


def main() -> int:
    asset_id = os.environ.get("VAST_ASSET_ID", "")
    control_plane_url = os.environ.get("CONTROL_PLANE_URL", "http://localhost:3000")
    project_id = os.environ.get("VAST_PROJECT_ID", "")

    # Resolve parse result: standalone mode uses OTIO_PARSE_RESULT; chain mode
    # uses PREVIOUS_RESULT (set by DataEngine from the chained CloudEvent payload).
    parse_result_json = os.environ.get("OTIO_PARSE_RESULT", "") or os.environ.get("PREVIOUS_RESULT", "")

    if not asset_id:
        log.error("VAST_ASSET_ID must be set")
        return 1

    if not parse_result_json:
        log.error(
            "No parse result available. Set OTIO_PARSE_RESULT (standalone) "
            "or PREVIOUS_RESULT (chain mode, populated by DataEngine from ChainOrchestrator)."
        )
        return 1

    if not project_id:
        log.warning("VAST_PROJECT_ID not set — cannot perform hierarchy lookup")

    try:
        parse_result = json.loads(parse_result_json)
    except json.JSONDecodeError as e:
        log.error(f"Invalid OTIO_PARSE_RESULT JSON: {e}")
        return 1

    log.info(f"Conforming timeline for asset {asset_id}")

    clips = parse_result.get("clips", parse_result.get("tracks", []))
    if isinstance(clips, list) and clips and isinstance(clips[0], dict) and "clips" in clips[0]:
        # Flatten tracks -> clips
        flat_clips = []
        for track in clips:
            flat_clips.extend(track.get("clips", []))
        clips = flat_clips

    hierarchy_shots: dict[str, dict] = {}
    if project_id:
        hierarchy_shots = fetch_hierarchy_shots(control_plane_url, project_id)
        log.info(f"Loaded {len(hierarchy_shots)} shots from hierarchy")

    conform_results = conform_clips(clips, hierarchy_shots)
    matched = sum(1 for r in conform_results if r["conformStatus"] == "matched")
    total = len(conform_results)
    log.info(f"Conformed {matched}/{total} clips")

    publish_completion(
        function_name="timeline-conformer",
        asset_id=asset_id,
        success=True,
        metadata={
            "total_clips": total,
            "matched_clips": matched,
            "unmatched_clips": total - matched,
            "project_id": project_id,
            "conform_results": conform_results,
        },
    )

    return 0


if __name__ == "__main__":
    sys.exit(main())
