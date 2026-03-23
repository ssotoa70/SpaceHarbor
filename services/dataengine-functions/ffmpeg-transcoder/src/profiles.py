"""Profile loader for ffmpeg-transcoder.

Reads JSON preset files from the profiles/ directory and returns
validated TranscodeProfile instances.
"""

import json
import logging
from dataclasses import dataclass, field
from pathlib import Path

log = logging.getLogger("ffmpeg-transcoder")

PROFILES_DIR = Path(__file__).resolve().parent.parent / "profiles"

REQUIRED_FIELDS = ("name", "codec", "container", "pixel_format")


@dataclass
class TranscodeProfile:
    name: str
    codec: str
    container: str
    pixel_format: str
    description: str = ""
    codec_params: dict[str, str] = field(default_factory=dict)
    default_resolution: str | None = None
    audio_codec: str = "aac"
    audio_params: dict[str, str] = field(default_factory=dict)


class ProfileError(Exception):
    pass


def load_profile(name: str, profiles_dir: Path | None = None) -> TranscodeProfile:
    """Load a transcode profile by name from the profiles directory.

    Args:
        name: Profile name (without .json extension)
        profiles_dir: Override profiles directory (for testing)

    Returns:
        Validated TranscodeProfile instance

    Raises:
        ProfileError: If profile not found or invalid
    """
    base = profiles_dir or PROFILES_DIR
    path = base / f"{name}.json"
    if not path.exists():
        available = list_profiles(base)
        raise ProfileError(
            f"Profile '{name}' not found. Available: {', '.join(available) or 'none'}"
        )

    try:
        data = json.loads(path.read_text())
    except json.JSONDecodeError as e:
        raise ProfileError(f"Invalid JSON in profile '{name}': {e}")

    for key in REQUIRED_FIELDS:
        if key not in data:
            raise ProfileError(f"Profile '{name}' missing required field: {key}")

    return TranscodeProfile(
        name=data["name"],
        codec=data["codec"],
        container=data["container"],
        pixel_format=data["pixel_format"],
        description=data.get("description", ""),
        codec_params=data.get("codec_params", {}),
        default_resolution=data.get("default_resolution"),
        audio_codec=data.get("audio_codec", "aac"),
        audio_params=data.get("audio_params", {}),
    )


def list_profiles(profiles_dir: Path | None = None) -> list[str]:
    """List all available profile names."""
    base = profiles_dir or PROFILES_DIR
    if not base.exists():
        return []
    return sorted(p.stem for p in base.glob("*.json"))
