import pytest
import sys
import os

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

from path_parser import parse_render_path


def test_standard_exr_path():
    result = parse_render_path("projects/PROJ_NOVA/SEQ_010/SH040/render/v001/beauty.0001.exr")
    assert result["project_code"] == "PROJ_NOVA"
    assert result["sequence_code"] == "SEQ_010"
    assert result["shot_code"] == "SH040"
    assert result["version_label"] == "v001"
    assert result["filename"] == "beauty.0001.exr"
    assert result["extension"] == ".exr"


def test_episode_path():
    result = parse_render_path("projects/PROJ/EP02/SEQ_010/SH040/render/v001/file.exr")
    assert result["episode_code"] == "EP02"
    assert result["sequence_code"] == "SEQ_010"
    assert result["shot_code"] == "SH040"


def test_non_render_path_returns_none():
    result = parse_render_path("projects/PROJ/dailies/preview.mov")
    assert result is None


def test_missing_version_returns_none():
    result = parse_render_path("projects/PROJ/SEQ/SHOT/beauty.0001.exr")
    assert result is None


def test_mov_path():
    result = parse_render_path("projects/PROJ/SEQ_020/SH010/render/v003/output.mov")
    assert result["version_label"] == "v003"
    assert result["extension"] == ".mov"
