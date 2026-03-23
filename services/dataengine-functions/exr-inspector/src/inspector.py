"""Real EXR metadata extraction using oiiotool.

Extracts technical metadata from OpenEXR files including:
- Resolution and window bounds
- Color space and bit depth
- Channels and compression
- Frame range detection for sequences
- File integrity (MD5 checksum)
"""

import os
import re
import hashlib
import logging
import subprocess
import sys
from pathlib import Path
from typing import Optional

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", ".."))
from shared.input_validation import InputValidationError, validate_path

log = logging.getLogger(__name__)

# Configurable base directory for media files
_MEDIA_BASE_DIR = os.environ.get("SPACEHARBOR_MEDIA_BASE_DIR", "/data/media")


class ExrInspectorError(Exception):
    """Raised when EXR inspection fails."""


def _validate_file_path(file_path: str) -> str:
    """Validate file path against allowed base directory."""
    try:
        return validate_path(file_path, _MEDIA_BASE_DIR, label="EXR file path")
    except InputValidationError as e:
        raise ExrInspectorError(str(e))


def extract_exr_metadata(file_path: str) -> dict:
    """Extract real metadata from an EXR file using oiiotool."""
    file_path = _validate_file_path(file_path)
    if not Path(file_path).exists():
        raise ExrInspectorError(f"EXR file not found: {file_path}")

    file_size = os.path.getsize(file_path)
    md5_checksum = _calculate_md5(file_path)
    oiiotool_info = _run_oiiotool_info(file_path)
    metadata = _parse_oiiotool_output(oiiotool_info)

    metadata["file_size_bytes"] = file_size
    metadata["checksum"] = md5_checksum
    metadata["codec"] = "exr"
    metadata["vast_storage_path"] = file_path

    frame_range_info = detect_frame_range(file_path)
    if frame_range_info:
        metadata["frame_range"] = frame_range_info["frame_range"]
        metadata["frame_rate"] = frame_range_info.get("frame_rate", 24.0)

    return metadata


def detect_frame_range(file_path: str) -> Optional[dict]:
    """Detect if file is part of a sequence and return frame range info.

    Supports patterns like render.0001.exr, render_1001.exr.
    """
    path = Path(file_path)
    directory = path.parent
    filename = path.name

    frame_patterns = [
        r"^(.+?)\.(\d{4})\.exr$",
        r"^(.+?)_(\d{4})\.exr$",
        r"^(.+?)\.(\d+)\.exr$",
    ]

    current_frame = None

    for pattern in frame_patterns:
        match = re.match(pattern, filename)
        if match:
            current_frame = int(match.group(2))
            break

    if current_frame is None:
        return None

    # Find all matching files in the directory
    try:
        frame_str = str(current_frame).zfill(4)
        glob_pattern = filename.replace(frame_str, "????")
        matching_files = sorted(directory.glob(glob_pattern))

        if len(matching_files) <= 1:
            return None

        frame_numbers = []
        for f in matching_files:
            for pattern in frame_patterns:
                m = re.match(pattern, f.name)
                if m:
                    frame_numbers.append(int(m.group(2)))
                    break

        if not frame_numbers:
            return None

        frame_numbers.sort()
        return {
            "frame_range": {"first": frame_numbers[0], "last": frame_numbers[-1]},
            "frame_rate": 24.0,
        }
    except Exception as e:
        log.warning(f"Failed to detect frame range for {file_path}: {e}")
        return None


def _run_oiiotool_info(file_path: str) -> str:
    """Run oiiotool --info -v on the file and return output."""
    try:
        result = subprocess.run(
            ["oiiotool", "--info", "-v", file_path],
            capture_output=True,
            text=True,
            timeout=10,
        )
    except FileNotFoundError:
        raise ExrInspectorError("oiiotool not found in PATH")
    except subprocess.TimeoutExpired:
        raise ExrInspectorError(f"oiiotool timed out processing {file_path}")

    if result.returncode != 0:
        raise ExrInspectorError(f"oiiotool failed: {result.stderr or result.stdout}")

    return result.stdout


def _parse_oiiotool_output(output: str) -> dict:
    """Parse oiiotool --info -v output to extract metadata."""
    metadata: dict = {
        "channels": [],
        "resolution": {"width": 0, "height": 0},
        "color_space": "linear",
        "compression_type": "unknown",
        "bit_depth": 32,
        "pixel_aspect_ratio": 1.0,
        "display_window": {"x_min": 0, "y_min": 0, "x_max": 0, "y_max": 0},
        "data_window": {"x_min": 0, "y_min": 0, "x_max": 0, "y_max": 0},
        # Provenance fields (Phase C) — extracted from EXR custom headers
        "provenance": {},
    }

    for line in output.split("\n"):
        line = line.strip()

        # Resolution
        if "Resolution:" in line or "size" in line.lower():
            match = re.search(r"(\d+)\s*x\s*(\d+)", line)
            if match:
                w, h = int(match.group(1)), int(match.group(2))
                metadata["resolution"] = {"width": w, "height": h}
                metadata["display_window"] = {"x_min": 0, "y_min": 0, "x_max": w - 1, "y_max": h - 1}
                metadata["data_window"] = {"x_min": 0, "y_min": 0, "x_max": w - 1, "y_max": h - 1}

        # Channels
        if "Channels:" in line:
            channels_str = line.split("Channels:", 1)[1].strip()
            metadata["channels"] = [c.strip() for c in channels_str.split()]

        # Color space
        if "colorspace" in line.lower() or "color_space" in line.lower():
            if "=" in line:
                metadata["color_space"] = line.split("=", 1)[1].strip().strip('"').lower()
            elif ":" in line:
                metadata["color_space"] = line.split(":", 1)[1].strip().strip('"').lower()

        # Compression
        if "compression" in line.lower():
            for comp in ["piz", "zip", "rle", "dwaa", "dwaab", "none"]:
                if comp in line.lower():
                    metadata["compression_type"] = comp.upper()
                    break

        # Bit depth
        if "float" in line.lower():
            metadata["bit_depth"] = 32
        elif "half" in line.lower():
            metadata["bit_depth"] = 16

        # Pixel aspect ratio
        if "pixel aspect" in line.lower() or "pixelaspect" in line.lower():
            match = re.search(r"(\d+\.?\d*)", line)
            if match:
                metadata["pixel_aspect_ratio"] = float(match.group(1))

        # Display window
        if "displaywindow" in line.lower() or "display window" in line.lower():
            match = re.search(r"\((\d+),\s*(\d+)\)\s*-\s*\((\d+),\s*(\d+)\)", line)
            if match:
                metadata["display_window"] = {
                    "x_min": int(match.group(1)), "y_min": int(match.group(2)),
                    "x_max": int(match.group(3)), "y_max": int(match.group(4)),
                }

        # Data window
        if "datawindow" in line.lower() or "data window" in line.lower():
            match = re.search(r"\((\d+),\s*(\d+)\)\s*-\s*\((\d+),\s*(\d+)\)", line)
            if match:
                metadata["data_window"] = {
                    "x_min": int(match.group(1)), "y_min": int(match.group(2)),
                    "x_max": int(match.group(3)), "y_max": int(match.group(4)),
                }

        # Provenance: Software header (creator DCC application)
        if "software" in line.lower() and "=" in line:
            software_val = line.split("=", 1)[1].strip().strip('"')
            metadata["provenance"]["dcc"] = software_val
            # Try to split "Nuke 15.0v4" into name + version
            parts = software_val.split(None, 1)
            if len(parts) == 2:
                metadata["provenance"]["dcc"] = parts[0]
                metadata["provenance"]["dcc_version"] = parts[1]

        # Provenance: capDate (capture/render date)
        if "capdate" in line.lower() and ("=" in line or ":" in line):
            sep = "=" if "=" in line else ":"
            metadata["provenance"]["cap_date"] = line.split(sep, 1)[1].strip().strip('"')

        # Provenance: renderJobId (custom header from render farms)
        if "renderjobid" in line.lower() and ("=" in line or ":" in line):
            sep = "=" if "=" in line else ":"
            metadata["provenance"]["render_job_id"] = line.split(sep, 1)[1].strip().strip('"')

        # Provenance: renderEngine (e.g. "Arnold", "Karma", "V-Ray")
        if "renderengine" in line.lower() and ("=" in line or ":" in line):
            sep = "=" if "=" in line else ":"
            metadata["provenance"]["render_engine"] = line.split(sep, 1)[1].strip().strip('"')

        # Provenance: hostname (render farm node)
        if "hostname" in line.lower() and ("=" in line or ":" in line):
            sep = "=" if "=" in line else ":"
            metadata["provenance"]["render_farm_node"] = line.split(sep, 1)[1].strip().strip('"')

    # Remove empty provenance dict if nothing was extracted
    if not metadata["provenance"]:
        del metadata["provenance"]

    return metadata


def _calculate_md5(file_path: str, chunk_size: int = 8192) -> str:
    """Calculate MD5 checksum of a file (read in chunks)."""
    md5_hash = hashlib.md5()
    try:
        with open(file_path, "rb") as f:
            for chunk in iter(lambda: f.read(chunk_size), b""):
                md5_hash.update(chunk)
    except IOError as e:
        log.error(f"Failed to read file {file_path} for checksum: {e}")
        return ""
    return md5_hash.hexdigest()
