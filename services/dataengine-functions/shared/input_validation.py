"""Shared input validation utilities for DataEngine functions.

Provides reusable validation functions to prevent command injection
and path traversal attacks in subprocess-calling functions.

All validators follow a reject-on-invalid pattern: they raise ValueError
with a clear message rather than attempting to sanitize/strip inputs.
"""

import os
import re
from pathlib import Path

# --- Patterns ---

# Safe text for FFmpeg drawtext burn-in: alphanumeric, spaces, and basic punctuation.
# Rejects FFmpeg filter-graph control characters: ; [ ] ' = \ and others.
SAFE_TEXT_PATTERN = re.compile(r"^[a-zA-Z0-9 _\-.:()]+$")

# Safe identifiers (asset IDs, profile names, etc.)
SAFE_ID_PATTERN = re.compile(r"^[a-zA-Z0-9_-]+$")

# Allowed media file extensions for source/output files
ALLOWED_MEDIA_EXTENSIONS = frozenset(
    {".exr", ".dpx", ".tif", ".tiff", ".png", ".jpg", ".jpeg", ".hdr", ".tx",
     ".mov", ".mp4", ".mxf", ".mkv", ".avi", ".wav", ".mp3", ".aac", ".flac"}
)

# Allowed LUT file extensions
ALLOWED_LUT_EXTENSIONS = frozenset({".cube", ".3dl", ".csp", ".lut"})

# Default base directory for media files (configurable via env var)
DEFAULT_MEDIA_BASE_DIR = "/data/media"

# Default base directory for LUT files (configurable via env var)
DEFAULT_LUT_BASE_DIR = "/data/luts"


class InputValidationError(ValueError):
    """Raised when an input fails validation."""


def validate_path(path: str, base_dir: str, *, label: str = "Path") -> str:
    """Validate and canonicalize a file path against a base directory.

    Ensures the resolved path is within the allowed base directory,
    preventing path traversal attacks via '..' segments or symlinks.

    Args:
        path: The file path to validate.
        base_dir: The allowed base directory.
        label: Human-readable label for error messages (e.g., "Source path").

    Returns:
        The canonicalized (resolved) path as a string.

    Raises:
        InputValidationError: If the path is invalid or outside the base directory.
    """
    if not path:
        raise InputValidationError(f"{label} must not be empty")

    # Reject explicit '..' segments before resolving
    parts = path.replace("\\", "/").split("/")
    if ".." in parts:
        raise InputValidationError(
            f"{label} must not contain directory traversal (..): '{path}'"
        )

    real_path = os.path.realpath(path)
    real_base = os.path.realpath(base_dir)

    # Ensure the base ends with a separator for prefix comparison,
    # handling the root directory case (where real_base is just "/").
    base_prefix = real_base if real_base.endswith(os.sep) else real_base + os.sep

    if not real_path.startswith(base_prefix) and real_path != real_base:
        raise InputValidationError(
            f"{label} '{path}' resolves outside allowed directory '{base_dir}'"
        )

    return real_path


def validate_media_path(
    path: str,
    base_dir: str | None = None,
    *,
    label: str = "Media path",
    allowed_extensions: frozenset[str] | None = None,
) -> str:
    """Validate a media file path: base-directory confinement + extension check.

    Args:
        path: The file path to validate.
        base_dir: Allowed base directory (defaults to SPACEHARBOR_MEDIA_BASE_DIR env var
                  or /data/media).
        label: Human-readable label for error messages.
        allowed_extensions: Set of allowed file extensions (defaults to ALLOWED_MEDIA_EXTENSIONS).

    Returns:
        The canonicalized path as a string.

    Raises:
        InputValidationError: If validation fails.
    """
    if base_dir is None:
        base_dir = os.environ.get("SPACEHARBOR_MEDIA_BASE_DIR", DEFAULT_MEDIA_BASE_DIR)

    exts = allowed_extensions if allowed_extensions is not None else ALLOWED_MEDIA_EXTENSIONS
    validated = validate_path(path, base_dir, label=label)

    suffix = Path(validated).suffix.lower()
    if suffix and exts and suffix not in exts:
        raise InputValidationError(
            f"{label} has disallowed extension '{suffix}'. "
            f"Allowed: {sorted(exts)}"
        )

    return validated


def validate_lut_path(path: str, base_dir: str | None = None) -> str:
    """Validate a 3D LUT file path: base-directory confinement + extension check.

    Args:
        path: The LUT file path to validate.
        base_dir: Allowed LUT directory (defaults to SPACEHARBOR_LUT_BASE_DIR env var
                  or /data/luts).

    Returns:
        The canonicalized path as a string.

    Raises:
        InputValidationError: If validation fails.
    """
    if base_dir is None:
        base_dir = os.environ.get("SPACEHARBOR_LUT_BASE_DIR", DEFAULT_LUT_BASE_DIR)

    validated = validate_path(path, base_dir, label="LUT path")

    suffix = Path(validated).suffix.lower()
    if suffix not in ALLOWED_LUT_EXTENSIONS:
        raise InputValidationError(
            f"LUT path has disallowed extension '{suffix}'. "
            f"Allowed: {sorted(ALLOWED_LUT_EXTENSIONS)}"
        )

    return validated


def validate_burn_in_text(text: str) -> str:
    """Validate burn-in text for FFmpeg drawtext filter.

    Only allows alphanumeric characters, spaces, and basic punctuation
    to prevent FFmpeg filter-graph injection.

    Args:
        text: The burn-in text to validate.

    Returns:
        The validated text (unchanged).

    Raises:
        InputValidationError: If text contains disallowed characters.
    """
    if not text:
        raise InputValidationError("Burn-in text must not be empty")

    if not SAFE_TEXT_PATTERN.match(text):
        raise InputValidationError(
            f"Burn-in text contains disallowed characters: '{text}'. "
            "Only alphanumeric, spaces, and _ - . : ( ) are allowed."
        )

    return text


def validate_asset_id(asset_id: str) -> str:
    """Validate an asset ID against the safe identifier pattern.

    Args:
        asset_id: The asset ID to validate.

    Returns:
        The validated asset ID (unchanged).

    Raises:
        InputValidationError: If the ID contains disallowed characters.
    """
    if not asset_id:
        raise InputValidationError("Asset ID must not be empty")

    if not SAFE_ID_PATTERN.match(asset_id):
        raise InputValidationError(
            f"Asset ID contains disallowed characters: '{asset_id}'. "
            "Only alphanumeric, hyphens, and underscores are allowed."
        )

    return asset_id


def validate_timecode(timecode: str) -> str:
    """Validate a timecode string (HH:MM:SS:FF or HH:MM:SS;FF).

    Args:
        timecode: The timecode string to validate.

    Returns:
        The validated timecode (unchanged).

    Raises:
        InputValidationError: If the timecode format is invalid.
    """
    if not timecode:
        raise InputValidationError("Timecode must not be empty")

    pattern = re.compile(r"^\d{2}:\d{2}:\d{2}[:;]\d{2}$")
    if not pattern.match(timecode):
        raise InputValidationError(
            f"Timecode has invalid format: '{timecode}'. "
            "Expected HH:MM:SS:FF or HH:MM:SS;FF."
        )

    return timecode
