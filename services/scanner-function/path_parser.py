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

SUPPORTED_EXTENSIONS = {".exr", ".mov", ".dpx", ".audio", ".wav", ".vdb", ".usd"}


def parse_render_path(key: str) -> Optional[dict]:
    """
    Parse an S3 object key into structured VFX hierarchy fields.
    Returns None if the key does not match the expected render path pattern
    or the file extension is not supported.
    """
    m = RENDER_PATTERN.match(key)
    if not m:
        return None
    filename = m.group("filename")
    ext = "." + filename.rsplit(".", 1)[-1].lower() if "." in filename else ""
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
    }
