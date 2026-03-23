"""OTIO (OpenTimelineIO) parser for extracting timeline structure.

Parses .otio, .edl, and .xml timeline files and extracts tracks,
clips, frame ranges, and source media references.
"""

import logging
from typing import Any, Optional

try:
    import opentimelineio as otio

    HAS_OTIO = True
except ImportError:
    HAS_OTIO = False

log = logging.getLogger(__name__)


class OtioParserError(Exception):
    """Raised when OTIO parsing fails."""


def parse_timeline(file_path: str) -> dict:
    """Parse a timeline file and return structured manifest.

    Args:
        file_path: Path to .otio, .edl, or .xml file.

    Returns:
        Dictionary with timeline_name, frame_rate, duration_frames, and tracks.
    """
    if not HAS_OTIO:
        raise ImportError(
            "opentimelineio is not installed. Install via: pip install opentimelineio>=0.16.0"
        )

    try:
        timeline = otio.adapters.read_from_file(file_path)
    except Exception as e:
        raise OtioParserError(f"Failed to read timeline: {e}") from e

    if not isinstance(timeline, otio.schema.Timeline):
        raise OtioParserError(f"Expected Timeline, got {type(timeline).__name__}")

    frame_rate = _get_frame_rate(timeline)
    duration_frames = _rational_time_to_frames(timeline.duration(), frame_rate)

    tracks = []
    for track in timeline.tracks:
        track_data = _extract_track(track, frame_rate)
        tracks.append(track_data)

    return {
        "timeline_name": timeline.name or "untitled",
        "frame_rate": frame_rate,
        "duration_frames": duration_frames,
        "tracks": tracks,
    }


def _get_frame_rate(timeline: Any) -> float:
    """Extract frame rate from timeline global start time or first clip."""
    if timeline.global_start_time is not None:
        return timeline.global_start_time.rate
    # Fall back to first track's rate
    for track in timeline.tracks:
        for item in track:
            if hasattr(item, "duration") and item.duration().rate > 0:
                return item.duration().rate
    return 24.0


def _rational_time_to_frames(rt: Any, default_rate: float) -> int:
    """Convert RationalTime to integer frame count."""
    if rt is None:
        return 0
    rate = rt.rate if rt.rate > 0 else default_rate
    return int(rt.value * rate / rt.rate) if rt.rate > 0 else int(rt.value)


def _extract_track(track: Any, frame_rate: float) -> dict:
    """Extract track info with clips."""
    kind = "video"
    if hasattr(track, "kind"):
        kind = str(track.kind)

    clips = []
    for item in track:
        if isinstance(item, otio.schema.Clip):
            clip_data = _extract_clip(item, frame_rate)
            clips.append(clip_data)

    return {
        "name": track.name or f"Track_{kind}",
        "kind": kind,
        "clips": clips,
    }


def _extract_clip(clip: Any, frame_rate: float) -> dict:
    """Extract clip info including source reference and frame range."""
    source_uri = _get_source_uri(clip)
    in_frame = 0
    out_frame = 0
    duration_frames = 0

    if clip.source_range is not None:
        sr = clip.source_range
        in_frame = int(sr.start_time.value)
        duration_frames = int(sr.duration.value)
        out_frame = in_frame + duration_frames - 1

    shot_name = _infer_shot_name(clip)

    result: dict[str, Any] = {
        "clip_name": clip.name or "unnamed",
        "source_uri": source_uri,
        "in_frame": in_frame,
        "out_frame": out_frame,
        "duration_frames": duration_frames,
    }
    if shot_name:
        result["shot_name"] = shot_name

    return result


def _get_source_uri(clip: Any) -> Optional[str]:
    """Extract source URI from clip's media reference."""
    if clip.media_reference is None:
        return None
    if isinstance(clip.media_reference, otio.schema.MissingReference):
        return None
    if hasattr(clip.media_reference, "target_url"):
        return clip.media_reference.target_url
    return None


def _infer_shot_name(clip: Any) -> Optional[str]:
    """Try to infer shot name from clip name or metadata."""
    name = clip.name or ""
    # Common patterns: SH010, sh_010, shot_010
    import re

    match = re.search(r"((?:SH|sh|shot)[_]?\d{3,4})", name)
    if match:
        return match.group(1)

    # Check metadata
    if hasattr(clip, "metadata") and isinstance(clip.metadata, dict):
        for key in ("shot", "shotName", "shot_name"):
            if key in clip.metadata:
                return str(clip.metadata[key])

    return None
