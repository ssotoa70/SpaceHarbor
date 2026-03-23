import re
from typing import Optional

# Standard render path: projects/{PROJECT}/{SEQUENCE}/{SHOT}/render/{VERSION}/{filename}
# With episode:         projects/{PROJECT}/{EPISODE}/{SEQUENCE}/{SHOT}/render/{VERSION}/{filename}
RENDER_PATTERN = re.compile(
    r"^projects/"
    r"(?P<project>[^/]+)/"
    r"(?:(?P<episode>EP\w+)/)?"   # optional episode segment (EP01, EP02, ...)
    r"(?P<sequence>[^/]+)/"
    r"(?P<shot>[^/]+)/"
    r"render/"
    r"(?P<version>v\d+[^/]*)/"   # v001, v002_colorfix, etc.
    r"(?P<filename>[^/]+)$"
)

# .ready is the sentinel extension for render sequences.
# When a renderer finishes writing all frames to the VAST view it drops a
# zero-byte "<shot>_<version>.ready" file in the same render directory.
# The DataEngine ElementCreated trigger fires on this file, and the scanner
# aggregates the whole frame sequence into a single asset instead of
# ingesting every individual EXR frame.
SENTINEL_EXTENSION = ".ready"

SUPPORTED_EXTENSIONS = {".exr", ".mov", ".dpx", ".audio", ".wav", ".vdb", ".usd", ".usda", ".usdc", ".usdz", ".abc"}


def parse_render_path(key: str) -> Optional[dict]:
    """
    Parse an S3 object key into structured VFX hierarchy fields.
    Returns None if the key does not match the expected render path pattern
    or the file extension is not supported.

    When the key ends with SENTINEL_EXTENSION (.ready), the sentinel is
    detected and the result includes ``"is_sentinel": True`` along with the
    render directory path so the caller can aggregate the frame sequence.
    The ``filename`` in a sentinel result is the directory path, not the
    .ready file itself, so the asset title reflects the sequence, not the
    trigger file.
    """
    m = RENDER_PATTERN.match(key)
    if not m:
        return None
    filename = m.group("filename")
    ext = "." + filename.rsplit(".", 1)[-1].lower() if "." in filename else ""

    # Sentinel path: aggregate the whole render directory as one asset.
    if ext == SENTINEL_EXTENSION:
        # The render directory is the parent of the .ready file.
        render_dir = key[: key.rfind("/") + 1]  # e.g. "projects/PROJ/SEQ/SH/render/v001/"
        # Use the directory path (without trailing slash) as the representative asset path.
        asset_path = render_dir.rstrip("/")
        return {
            "project_code":  m.group("project"),
            "episode_code":  m.group("episode"),
            "sequence_code": m.group("sequence"),
            "shot_code":     m.group("shot"),
            "version_label": m.group("version"),
            "filename":      asset_path,   # directory path — used as asset title/source URI
            "extension":     SENTINEL_EXTENSION,
            "is_sentinel":   True,
        }

    if ext not in SUPPORTED_EXTENSIONS:
        return None
    return {
        "project_code":  m.group("project"),
        "episode_code":  m.group("episode"),   # None if not episodic
        "sequence_code": m.group("sequence"),
        "shot_code":     m.group("shot"),
        "version_label": m.group("version"),
        "filename":      filename,
        "extension":     ext,
        "is_sentinel":   False,
    }
