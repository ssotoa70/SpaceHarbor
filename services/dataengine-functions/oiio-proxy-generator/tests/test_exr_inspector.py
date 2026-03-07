"""Tests for EXR metadata extraction module."""

import pytest
import re
from unittest.mock import patch
from src.exr_inspector import (
    extract_exr_metadata,
    detect_frame_range,
    ExrInspectorError,
    _parse_oiiotool_output,
    _calculate_md5,
)


@pytest.fixture
def sample_oiiotool_output():
    return """
  Input: "/tmp/test.exr"
  Resolution: 4096 x 2160
  Channels: R G B A depth
  Datatype: FLOAT
  Colorspace: linear
  Compression: PIZ
  Pixel aspect ratio: 1.0
  Display window: (0, 0) - (4095, 2159)
  Data window: (0, 0) - (4095, 2159)
"""


@pytest.fixture
def temp_exr_file(tmp_path):
    test_file = tmp_path / "test.exr"
    test_file.write_bytes(b"fake exr content" * 100)
    return str(test_file)


class TestParseOiiotoolOutput:
    def test_parse_resolution(self, sample_oiiotool_output):
        metadata = _parse_oiiotool_output(sample_oiiotool_output)
        assert metadata["resolution"]["width"] == 4096
        assert metadata["resolution"]["height"] == 2160

    def test_parse_channels(self, sample_oiiotool_output):
        metadata = _parse_oiiotool_output(sample_oiiotool_output)
        assert metadata["channels"] == ["R", "G", "B", "A", "depth"]

    def test_parse_compression(self, sample_oiiotool_output):
        metadata = _parse_oiiotool_output(sample_oiiotool_output)
        assert metadata["compression_type"] == "PIZ"

    def test_parse_colorspace(self, sample_oiiotool_output):
        metadata = _parse_oiiotool_output(sample_oiiotool_output)
        assert metadata["color_space"] == "linear"

    def test_parse_display_window(self, sample_oiiotool_output):
        metadata = _parse_oiiotool_output(sample_oiiotool_output)
        assert metadata["display_window"] == {"x_min": 0, "y_min": 0, "x_max": 4095, "y_max": 2159}

    def test_parse_data_window(self, sample_oiiotool_output):
        metadata = _parse_oiiotool_output(sample_oiiotool_output)
        assert metadata["data_window"] == {"x_min": 0, "y_min": 0, "x_max": 4095, "y_max": 2159}

    def test_parse_bit_depth_float(self):
        metadata = _parse_oiiotool_output("Datatype: FLOAT")
        assert metadata["bit_depth"] == 32

    def test_parse_bit_depth_half(self):
        metadata = _parse_oiiotool_output("Channels: R(half) G(half) B(half)")
        assert metadata["bit_depth"] == 16

    def test_parse_pixel_aspect_ratio(self):
        metadata = _parse_oiiotool_output("Pixel aspect ratio: 1.5")
        assert metadata["pixel_aspect_ratio"] == 1.5

    def test_parse_colorspace_variations(self):
        cases = [
            ("colorSpace: sRGB", "srgb"),
            ("color_space: ACEScg", "acescg"),
            ("oiio:ColorSpace = linear", "linear"),
        ]
        for output, expected in cases:
            metadata = _parse_oiiotool_output(output)
            assert metadata["color_space"] == expected

    def test_parse_compression_variations(self):
        cases = [
            ("Compression: ZIP", "ZIP"),
            ("compression: rle", "RLE"),
            ("Compression: DWAA", "DWAA"),
        ]
        for output, expected in cases:
            metadata = _parse_oiiotool_output(output)
            assert metadata["compression_type"] == expected


class TestCalculateMd5:
    def test_calculate_md5(self, temp_exr_file):
        checksum = _calculate_md5(temp_exr_file)
        assert len(checksum) == 32
        assert all(c in "0123456789abcdef" for c in checksum)

    def test_calculate_md5_consistency(self, temp_exr_file):
        assert _calculate_md5(temp_exr_file) == _calculate_md5(temp_exr_file)

    def test_calculate_md5_missing_file(self):
        assert _calculate_md5("/nonexistent/file.exr") == ""


class TestDetectFrameRange:
    def test_detect_four_digit_pattern(self, tmp_path):
        for i in range(1001, 1005):
            (tmp_path / f"render.{i}.exr").write_text("content")
        result = detect_frame_range(str(tmp_path / "render.1002.exr"))
        assert result is not None
        assert result["frame_range"]["first"] == 1001
        assert result["frame_range"]["last"] == 1004

    def test_detect_underscore_pattern(self, tmp_path):
        for i in range(1, 4):
            (tmp_path / f"render_{i:04d}.exr").write_text("content")
        result = detect_frame_range(str(tmp_path / "render_0002.exr"))
        assert result is not None
        assert result["frame_range"]["first"] == 1
        assert result["frame_range"]["last"] == 3

    def test_no_sequence(self, tmp_path):
        (tmp_path / "single_frame.exr").write_text("content")
        assert detect_frame_range(str(tmp_path / "single_frame.exr")) is None

    def test_default_frame_rate(self, tmp_path):
        for i in range(1, 3):
            (tmp_path / f"render.{i:04d}.exr").write_text("content")
        result = detect_frame_range(str(tmp_path / "render.0001.exr"))
        assert result is not None
        assert result["frame_rate"] == 24.0


class TestExtractExrMetadata:
    def test_file_not_found(self):
        with pytest.raises(ExrInspectorError, match="not found"):
            extract_exr_metadata("/nonexistent/file.exr")

    @patch("src.exr_inspector._run_oiiotool_info")
    def test_with_mock_oiiotool(self, mock_run, temp_exr_file, sample_oiiotool_output):
        mock_run.return_value = sample_oiiotool_output
        metadata = extract_exr_metadata(temp_exr_file)
        assert metadata["codec"] == "exr"
        assert metadata["resolution"]["width"] == 4096
        assert metadata["file_size_bytes"] > 0
        assert len(metadata["md5_checksum"]) == 32

    @patch("src.exr_inspector._run_oiiotool_info")
    def test_oiiotool_not_found(self, mock_run, temp_exr_file):
        mock_run.side_effect = ExrInspectorError("oiiotool not found in PATH")
        with pytest.raises(ExrInspectorError, match="oiiotool not found"):
            extract_exr_metadata(temp_exr_file)

    @patch("src.exr_inspector.detect_frame_range")
    @patch("src.exr_inspector._run_oiiotool_info")
    def test_with_sequence(self, mock_run, mock_detect, temp_exr_file, sample_oiiotool_output):
        mock_run.return_value = sample_oiiotool_output
        mock_detect.return_value = {
            "frame_range": {"first": 1001, "last": 1240},
            "frame_rate": 24.0,
        }
        metadata = extract_exr_metadata(temp_exr_file)
        assert metadata["frame_range"]["first"] == 1001
        assert metadata["frame_range"]["last"] == 1240
        assert metadata["frame_rate"] == 24.0
