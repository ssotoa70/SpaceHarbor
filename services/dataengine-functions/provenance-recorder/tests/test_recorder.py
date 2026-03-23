"""Unit tests for provenance-recorder metadata extraction."""

import os
import subprocess
from pathlib import Path
from unittest.mock import patch, MagicMock

import pytest

# Ensure permissive base dirs for test paths
os.environ.setdefault("SPACEHARBOR_MEDIA_BASE_DIR", "/")

from src.recorder import (
    extract_provenance,
    ProvenanceRecorderError,
    _extract_os_metadata,
    _extract_exr_headers,
    _extract_exif_metadata,
    _get_hostname,
)


class TestExtractProvenance:
    """Tests for the top-level extract_provenance function."""

    def test_file_not_found_raises(self):
        with pytest.raises(ProvenanceRecorderError, match="File not found"):
            extract_provenance("/nonexistent/path/file.exr")

    def test_basic_fields_always_present(self, tmp_path):
        f = tmp_path / "test.exr"
        f.write_bytes(b"\x00" * 64)

        result = extract_provenance(str(f))

        assert result["vast_storage_path"] == str(f)
        assert result["file_size_bytes"] == 64
        assert isinstance(result["source_host"], str)
        assert isinstance(result["source_process_id"], int)
        assert "creation_time" in result
        assert "modification_time" in result

    def test_creator_extracted_from_os(self, tmp_path):
        f = tmp_path / "test.png"
        f.write_bytes(b"\x89PNG")

        result = extract_provenance(str(f))

        # creator should be a string (username or uid)
        assert "creator" in result
        assert isinstance(result["creator"], str)

    def test_exr_triggers_header_extraction(self, tmp_path):
        f = tmp_path / "render.exr"
        f.write_bytes(b"\x76\x2f\x31\x01" + b"\x00" * 60)

        with patch("src.recorder._extract_exr_headers") as mock:
            mock.return_value = {"software": "Nuke", "software_version": "15.0v4"}
            result = extract_provenance(str(f))

        assert result["software"] == "Nuke"
        assert result["software_version"] == "15.0v4"

    def test_jpg_triggers_exif_extraction(self, tmp_path):
        f = tmp_path / "photo.jpg"
        f.write_bytes(b"\xff\xd8\xff\xe0" + b"\x00" * 60)

        with patch("src.recorder._extract_exif_metadata") as mock:
            mock.return_value = {"software": "Photoshop", "creator": "artist01"}
            result = extract_provenance(str(f))

        assert result["software"] == "Photoshop"
        assert result["creator"] == "artist01"


class TestOsMetadata:
    """Tests for OS metadata extraction."""

    def test_timestamps_are_iso_format(self, tmp_path):
        f = tmp_path / "test.exr"
        f.write_bytes(b"\x00" * 8)

        meta = _extract_os_metadata(f)

        assert "creation_time" in meta
        assert "modification_time" in meta
        # ISO format check
        assert "T" in meta["creation_time"]
        assert "T" in meta["modification_time"]


class TestExrHeaders:
    """Tests for EXR header extraction via oiiotool."""

    def test_oiiotool_not_found_returns_empty(self):
        with patch("subprocess.run", side_effect=FileNotFoundError):
            result = _extract_exr_headers("/fake/path.exr")
        assert result == {}

    def test_oiiotool_timeout_returns_empty(self):
        with patch("subprocess.run", side_effect=subprocess.TimeoutExpired("oiiotool", 10)):
            result = _extract_exr_headers("/fake/path.exr")
        assert result == {}

    def test_parses_software_header(self):
        mock_result = MagicMock()
        mock_result.returncode = 0
        mock_result.stdout = '    Software = "Nuke 15.0v4"\n'

        with patch("subprocess.run", return_value=mock_result):
            result = _extract_exr_headers("/fake/path.exr")

        assert result["software"] == "Nuke"
        assert result["software_version"] == "15.0v4"

    def test_parses_capdate_header(self):
        mock_result = MagicMock()
        mock_result.returncode = 0
        mock_result.stdout = '    capDate = "2026:03:13 10:30:00"\n'

        with patch("subprocess.run", return_value=mock_result):
            result = _extract_exr_headers("/fake/path.exr")

        assert result["cap_date"] == "2026:03:13 10:30:00"

    def test_parses_render_job_id(self):
        mock_result = MagicMock()
        mock_result.returncode = 0
        mock_result.stdout = '    renderJobId = "farm-job-42"\n'

        with patch("subprocess.run", return_value=mock_result):
            result = _extract_exr_headers("/fake/path.exr")

        assert result["render_job_id"] == "farm-job-42"

    def test_parses_render_engine(self):
        mock_result = MagicMock()
        mock_result.returncode = 0
        mock_result.stdout = '    renderEngine = "Arnold"\n'

        with patch("subprocess.run", return_value=mock_result):
            result = _extract_exr_headers("/fake/path.exr")

        assert result["render_engine"] == "Arnold"

    def test_parses_hostname(self):
        mock_result = MagicMock()
        mock_result.returncode = 0
        mock_result.stdout = '    hostname = "render-node-07"\n'

        with patch("subprocess.run", return_value=mock_result):
            result = _extract_exr_headers("/fake/path.exr")

        assert result["render_farm_node"] == "render-node-07"

    def test_parses_multiple_headers(self):
        mock_result = MagicMock()
        mock_result.returncode = 0
        mock_result.stdout = (
            '    Software = "Houdini 20.5.332"\n'
            '    renderEngine = "Karma"\n'
            '    hostname = "farm-gpu-12"\n'
            '    renderJobId = "hq-12345"\n'
            '    capDate = "2026:03:13 08:00:00"\n'
        )

        with patch("subprocess.run", return_value=mock_result):
            result = _extract_exr_headers("/fake/path.exr")

        assert result["software"] == "Houdini"
        assert result["software_version"] == "20.5.332"
        assert result["render_engine"] == "Karma"
        assert result["render_farm_node"] == "farm-gpu-12"
        assert result["render_job_id"] == "hq-12345"
        assert result["cap_date"] == "2026:03:13 08:00:00"


class TestExifMetadata:
    """Tests for EXIF metadata extraction via exiftool."""

    def test_exiftool_not_found_returns_empty(self):
        with patch("subprocess.run", side_effect=FileNotFoundError):
            result = _extract_exif_metadata("/fake/photo.jpg")
        assert result == {}

    def test_parses_exif_software(self):
        import json

        mock_result = MagicMock()
        mock_result.returncode = 0
        mock_result.stdout = json.dumps([{
            "Software": "Adobe Photoshop 25.4",
            "Artist": "john.doe",
            "HostComputer": "workstation-42",
            "CreateDate": "2026:03:13 14:00:00",
        }])

        with patch("subprocess.run", return_value=mock_result):
            result = _extract_exif_metadata("/fake/photo.tif")

        assert result["software"] == "Adobe"
        assert result["software_version"] == "Photoshop 25.4"
        assert result["creator"] == "john.doe"
        assert result["render_farm_node"] == "workstation-42"
        assert result["cap_date"] == "2026:03:13 14:00:00"


class TestGetHostname:
    """Tests for hostname resolution."""

    def test_returns_string(self):
        result = _get_hostname()
        assert isinstance(result, str)
        assert len(result) > 0

    def test_fallback_on_error(self):
        with patch("socket.gethostname", side_effect=OSError("fail")):
            result = _get_hostname()
        assert result == "unknown"
