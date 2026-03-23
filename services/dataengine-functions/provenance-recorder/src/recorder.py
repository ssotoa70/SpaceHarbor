"""Provenance metadata extraction from media files.

Extracts creator/software provenance from:
- OS file metadata (owner, timestamps, permissions)
- EXR headers (Software, capDate, hostname, renderJobId, renderEngine)
- EXIF metadata (Software, Artist, HostComputer)
- Generic file header signatures

All extractors are best-effort: missing metadata is omitted rather
than raising errors.
"""

import logging
import os
import subprocess
from datetime import datetime, timezone
from pathlib import Path
from typing import Optional

log = logging.getLogger(__name__)


class ProvenanceRecorderError(Exception):
    """Raised when provenance extraction fails fatally."""


def extract_provenance(file_path: str) -> dict:
    """Extract provenance metadata from a file.

    Combines OS metadata, file header inspection, and format-specific
    extractors to build a comprehensive provenance record.

    Args:
        file_path: Absolute path to the media file.

    Returns:
        Dict with provenance fields. Always includes:
          - vast_storage_path
          - file_size_bytes
          - source_host
          - source_process_id
        Optional fields (when extractable):
          - creator, software, software_version
          - creation_time, modification_time
          - render_engine, render_job_id, render_farm_node
          - cap_date, scene_file_path
    """
    path = Path(file_path)
    if not path.exists():
        raise ProvenanceRecorderError(f"File not found: {file_path}")

    provenance: dict = {
        "vast_storage_path": file_path,
        "file_size_bytes": path.stat().st_size,
        "source_host": _get_hostname(),
        "source_process_id": os.getpid(),
    }

    # OS-level metadata
    os_meta = _extract_os_metadata(path)
    provenance.update(os_meta)

    # Format-specific header extraction
    suffix = path.suffix.lower()
    if suffix == ".exr":
        header_meta = _extract_exr_headers(file_path)
        provenance.update(header_meta)
    elif suffix in (".jpg", ".jpeg", ".tif", ".tiff", ".png"):
        exif_meta = _extract_exif_metadata(file_path)
        provenance.update(exif_meta)

    return provenance


def _get_hostname() -> str:
    """Return the current hostname."""
    import socket

    try:
        return socket.gethostname()
    except Exception:
        return "unknown"


def _extract_os_metadata(path: Path) -> dict:
    """Extract OS-level file metadata (timestamps, owner)."""
    meta: dict = {}
    try:
        stat = path.stat()
        meta["creation_time"] = datetime.fromtimestamp(
            stat.st_ctime, tz=timezone.utc
        ).isoformat()
        meta["modification_time"] = datetime.fromtimestamp(
            stat.st_mtime, tz=timezone.utc
        ).isoformat()
        # Attempt to resolve UID to username (Unix only)
        try:
            import pwd

            pw = pwd.getpwuid(stat.st_uid)
            meta["creator"] = pw.pw_name
        except (ImportError, KeyError):
            meta["creator"] = str(stat.st_uid)
    except OSError as e:
        log.warning(f"Failed to read OS metadata for {path}: {e}")

    return meta


def _extract_exr_headers(file_path: str) -> dict:
    """Extract provenance fields from EXR headers using oiiotool.

    Parses the verbose info output for standard and custom headers:
      - Software (creator DCC)
      - capDate (capture/render date)
      - hostname (render farm node)
      - renderJobId (custom header)
      - renderEngine (custom header)
    """
    meta: dict = {}

    try:
        result = subprocess.run(
            ["oiiotool", "--info", "-v", file_path],
            capture_output=True,
            text=True,
            timeout=10,
        )
    except FileNotFoundError:
        log.warning("oiiotool not found — skipping EXR header extraction")
        return meta
    except subprocess.TimeoutExpired:
        log.warning(f"oiiotool timed out on {file_path}")
        return meta

    if result.returncode != 0:
        log.warning(f"oiiotool failed on {file_path}: {result.stderr}")
        return meta

    for line in result.stdout.split("\n"):
        line = line.strip()

        # Software header (creator DCC application)
        if "software" in line.lower() and "=" in line:
            software_val = line.split("=", 1)[1].strip().strip('"')
            parts = software_val.split(None, 1)
            meta["software"] = parts[0] if parts else software_val
            if len(parts) == 2:
                meta["software_version"] = parts[1]

        # capDate
        if "capdate" in line.lower() and ("=" in line or ":" in line):
            sep = "=" if "=" in line else ":"
            meta["cap_date"] = line.split(sep, 1)[1].strip().strip('"')

        # renderJobId
        if "renderjobid" in line.lower() and ("=" in line or ":" in line):
            sep = "=" if "=" in line else ":"
            meta["render_job_id"] = line.split(sep, 1)[1].strip().strip('"')

        # renderEngine
        if "renderengine" in line.lower() and ("=" in line or ":" in line):
            sep = "=" if "=" in line else ":"
            meta["render_engine"] = line.split(sep, 1)[1].strip().strip('"')

        # hostname (render farm node)
        if "hostname" in line.lower() and ("=" in line or ":" in line):
            sep = "=" if "=" in line else ":"
            meta["render_farm_node"] = line.split(sep, 1)[1].strip().strip('"')

    return meta


def _extract_exif_metadata(file_path: str) -> dict:
    """Extract provenance fields from EXIF metadata using exiftool.

    Falls back gracefully if exiftool is not available.
    """
    meta: dict = {}

    try:
        result = subprocess.run(
            ["exiftool", "-json", "-Software", "-Artist", "-HostComputer",
             "-CreateDate", "-ModifyDate", file_path],
            capture_output=True,
            text=True,
            timeout=10,
        )
    except FileNotFoundError:
        log.warning("exiftool not found — skipping EXIF extraction")
        return meta
    except subprocess.TimeoutExpired:
        log.warning(f"exiftool timed out on {file_path}")
        return meta

    if result.returncode != 0:
        log.warning(f"exiftool failed on {file_path}: {result.stderr}")
        return meta

    try:
        import json

        data_list = json.loads(result.stdout)
        if not data_list:
            return meta
        data = data_list[0]

        if data.get("Software"):
            software_val = data["Software"]
            parts = software_val.split(None, 1)
            meta["software"] = parts[0] if parts else software_val
            if len(parts) == 2:
                meta["software_version"] = parts[1]

        if data.get("Artist"):
            meta["creator"] = data["Artist"]

        if data.get("HostComputer"):
            meta["render_farm_node"] = data["HostComputer"]

        if data.get("CreateDate"):
            meta["cap_date"] = data["CreateDate"]

    except Exception as e:
        log.warning(f"Failed to parse exiftool output: {e}")

    return meta
