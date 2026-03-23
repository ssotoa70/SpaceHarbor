"""Tests for transcode profile loading and validation."""

import json
import pytest
from pathlib import Path

from src.profiles import load_profile, list_profiles, ProfileError, PROFILES_DIR


EXPECTED_PROFILES = [
    "av1_archive",
    "dnxhr_hqx",
    "dnxhr_sq",
    "ffv1_lossless",
    "h264_review",
    "prores_422_hq",
    "prores_4444",
]


class TestListProfiles:
    def test_lists_all_profiles(self):
        profiles = list_profiles()
        assert sorted(profiles) == EXPECTED_PROFILES

    def test_empty_dir_returns_empty(self, tmp_path):
        assert list_profiles(tmp_path) == []

    def test_nonexistent_dir_returns_empty(self, tmp_path):
        assert list_profiles(tmp_path / "nonexistent") == []


class TestLoadProfile:
    @pytest.mark.parametrize("name", EXPECTED_PROFILES)
    def test_all_profiles_load(self, name):
        profile = load_profile(name)
        assert profile.name == name
        assert profile.codec
        assert profile.container
        assert profile.pixel_format

    def test_prores_422_hq_details(self):
        p = load_profile("prores_422_hq")
        assert p.codec == "prores_ks"
        assert p.container == "mov"
        assert p.pixel_format == "yuv422p10le"
        assert p.codec_params["profile:v"] == "3"
        assert p.audio_codec == "pcm_s24le"

    def test_h264_review_details(self):
        p = load_profile("h264_review")
        assert p.codec == "libopenh264"
        assert p.container == "mp4"
        assert p.pixel_format == "yuv420p"
        assert p.default_resolution == "1920x1080"

    def test_ffv1_lossless_details(self):
        p = load_profile("ffv1_lossless")
        assert p.codec == "ffv1"
        assert p.container == "matroska"
        assert p.pixel_format == "yuv444p16le"
        assert p.audio_codec == "flac"

    def test_av1_archive_details(self):
        p = load_profile("av1_archive")
        assert p.codec == "libsvtav1"
        assert p.codec_params["crf"] == "30"

    def test_unknown_profile_raises(self):
        with pytest.raises(ProfileError, match="not found"):
            load_profile("nonexistent_profile")

    def test_missing_required_field(self, tmp_path):
        bad = tmp_path / "bad.json"
        bad.write_text(json.dumps({"name": "bad"}))
        with pytest.raises(ProfileError, match="missing required field"):
            load_profile("bad", profiles_dir=tmp_path)

    def test_invalid_json(self, tmp_path):
        bad = tmp_path / "broken.json"
        bad.write_text("{not valid json")
        with pytest.raises(ProfileError, match="Invalid JSON"):
            load_profile("broken", profiles_dir=tmp_path)

    @pytest.mark.parametrize("name", EXPECTED_PROFILES)
    def test_all_profiles_have_descriptions(self, name):
        p = load_profile(name)
        assert p.description, f"Profile {name} should have a description"
