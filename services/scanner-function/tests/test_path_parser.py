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


def test_usd_path():
    result = parse_render_path("projects/PROJ_NOVA/SEQ_010/SH040/render/v002/scene.usd")
    assert result["project_code"] == "PROJ_NOVA"
    assert result["extension"] == ".usd"


def test_usda_path():
    result = parse_render_path("projects/PROJ/SEQ_010/SH040/render/v001/lookdev.usda")
    assert result["extension"] == ".usda"
    assert result["filename"] == "lookdev.usda"


def test_usdc_path():
    result = parse_render_path("projects/PROJ/SEQ_010/SH040/render/v001/geo_cache.usdc")
    assert result["extension"] == ".usdc"


def test_usdz_path():
    result = parse_render_path("projects/PROJ/SEQ_010/SH040/render/v001/asset_preview.usdz")
    assert result["extension"] == ".usdz"


def test_alembic_path():
    result = parse_render_path("projects/PROJ/SEQ_010/SH040/render/v005/char_anim.abc")
    assert result["project_code"] == "PROJ"
    assert result["version_label"] == "v005"
    assert result["extension"] == ".abc"
    assert result["filename"] == "char_anim.abc"


def test_alembic_episode_path():
    result = parse_render_path("projects/PROJ/EP03/SEQ_010/SH040/render/v001/fx_cache.abc")
    assert result["episode_code"] == "EP03"
    assert result["extension"] == ".abc"


def test_unsupported_extension_returns_none():
    result = parse_render_path("projects/PROJ/SEQ/SH010/render/v001/random.xyz")
    assert result is None


# --- Sentinel (.ready) file handling ---

def test_ready_sentinel_is_detected():
    """A .ready file inside a render version directory triggers sentinel mode."""
    result = parse_render_path("projects/NOVA/SEQ_010/SH040/render/v001/beauty_v001.ready")
    assert result is not None
    assert result["is_sentinel"] is True
    assert result["extension"] == ".ready"


def test_ready_sentinel_returns_directory_path_not_ready_file():
    """.ready sentinel result filename must be the version directory, not the sentinel file itself."""
    result = parse_render_path("projects/NOVA/SEQ_010/SH040/render/v001/beauty_v001.ready")
    assert result is not None
    # filename should be the render directory (no trailing slash, no .ready filename)
    assert result["filename"] == "projects/NOVA/SEQ_010/SH040/render/v001"
    assert ".ready" not in result["filename"]


def test_ready_sentinel_preserves_hierarchy_fields():
    """Sentinel result must carry complete VFX hierarchy for hierarchy resolution."""
    result = parse_render_path("projects/NOVA/SEQ_010/SH040/render/v001/beauty_v001.ready")
    assert result is not None
    assert result["project_code"] == "NOVA"
    assert result["sequence_code"] == "SEQ_010"
    assert result["shot_code"] == "SH040"
    assert result["version_label"] == "v001"


def test_ready_sentinel_episode_path():
    """Episodic paths with .ready sentinel are also handled correctly."""
    result = parse_render_path("projects/PROJ/EP02/SEQ_010/SH040/render/v003/comp.ready")
    assert result is not None
    assert result["is_sentinel"] is True
    assert result["episode_code"] == "EP02"
    assert result["filename"] == "projects/PROJ/EP02/SEQ_010/SH040/render/v003"


def test_non_sentinel_result_has_is_sentinel_false():
    """Regular file paths must include is_sentinel=False for consistent caller interface."""
    result = parse_render_path("projects/PROJ/SEQ_010/SH040/render/v001/beauty.0001.exr")
    assert result is not None
    assert result["is_sentinel"] is False
