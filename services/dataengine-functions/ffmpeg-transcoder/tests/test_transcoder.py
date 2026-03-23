"""Tests for FFmpeg command building and transcoder logic."""

import pytest
from unittest.mock import patch

from src.transcoder import Transcoder, TranscodeError
from src.profiles import TranscodeProfile


@pytest.fixture
def transcoder():
    return Transcoder()


@pytest.fixture
def prores_profile():
    return TranscodeProfile(
        name="prores_422_hq",
        codec="prores_ks",
        container="mov",
        pixel_format="yuv422p10le",
        codec_params={"profile:v": "3", "vendor": "apl0"},
        audio_codec="pcm_s24le",
    )


@pytest.fixture
def h264_profile():
    return TranscodeProfile(
        name="h264_review",
        codec="libopenh264",
        container="mp4",
        pixel_format="yuv420p",
        codec_params={"b:v": "8M"},
        default_resolution="1920x1080",
        audio_codec="aac",
        audio_params={"b:a": "192k"},
    )


@pytest.fixture
def ffv1_profile():
    return TranscodeProfile(
        name="ffv1_lossless",
        codec="ffv1",
        container="matroska",
        pixel_format="yuv444p16le",
        codec_params={"level": "3", "slicecrc": "1"},
        audio_codec="flac",
    )


class TestBuildCommandVideoFile:
    def test_basic_prores(self, transcoder, prores_profile):
        cmd = transcoder.build_command(
            source="/data/input.mov",
            output="/data/output.mov",
            profile=prores_profile,
        )
        assert cmd[0] == "ffmpeg"
        assert "-y" in cmd
        assert cmd[cmd.index("-i") + 1] == "/data/input.mov"
        assert cmd[cmd.index("-c:v") + 1] == "prores_ks"
        assert cmd[cmd.index("-pix_fmt") + 1] == "yuv422p10le"
        assert cmd[cmd.index("-profile:v") + 1] == "3"
        assert cmd[cmd.index("-vendor") + 1] == "apl0"
        assert cmd[cmd.index("-f") + 1] == "mov"
        assert cmd[-1] == "/data/output.mov"

    def test_h264_with_resolution(self, transcoder, h264_profile):
        cmd = transcoder.build_command(
            source="/data/input.mov",
            output="/data/output.mp4",
            profile=h264_profile,
        )
        assert cmd[cmd.index("-c:v") + 1] == "libopenh264"
        assert cmd[cmd.index("-s") + 1] == "1920x1080"
        assert cmd[cmd.index("-c:a") + 1] == "aac"

    def test_h264_audio_params_with_source(self, transcoder, h264_profile):
        cmd = transcoder.build_command(
            source="/data/input.mov",
            output="/data/output.mp4",
            profile=h264_profile,
            audio_source="/data/audio.wav",
        )
        assert cmd[cmd.index("-c:a") + 1] == "aac"
        assert cmd[cmd.index("-b:a") + 1] == "192k"

    def test_ffv1_lossless(self, transcoder, ffv1_profile):
        cmd = transcoder.build_command(
            source="/data/input.mov",
            output="/data/output.mkv",
            profile=ffv1_profile,
        )
        assert cmd[cmd.index("-c:v") + 1] == "ffv1"
        assert cmd[cmd.index("-pix_fmt") + 1] == "yuv444p16le"
        assert cmd[cmd.index("-level") + 1] == "3"
        assert cmd[cmd.index("-f") + 1] == "matroska"

    def test_no_resolution_when_none(self, transcoder, prores_profile):
        cmd = transcoder.build_command(
            source="/data/input.mov",
            output="/data/output.mov",
            profile=prores_profile,
        )
        assert "-s" not in cmd


class TestBuildCommandImageSequence:
    def test_exr_sequence(self, transcoder, prores_profile):
        cmd = transcoder.build_command(
            source="/data/render.1001.exr",
            output="/data/output.mov",
            profile=prores_profile,
            framerate=24.0,
        )
        assert "-f" in cmd
        seq_idx = cmd.index("-f")
        assert cmd[seq_idx + 1] == "image2"
        assert cmd[cmd.index("-framerate") + 1] == "24.0"
        assert cmd[cmd.index("-start_number") + 1] == "1001"
        # Pattern should use %04d
        i_idx = cmd.index("-i")
        assert "%04d" in cmd[i_idx + 1]
        # No audio for image sequence without audio source
        assert "-an" in cmd

    def test_dpx_sequence(self, transcoder, prores_profile):
        cmd = transcoder.build_command(
            source="/data/plate_0001.dpx",
            output="/data/output.mov",
            profile=prores_profile,
        )
        i_idx = cmd.index("-i")
        assert "%04d" in cmd[i_idx + 1]

    def test_six_digit_frame_number(self, transcoder, prores_profile):
        cmd = transcoder.build_command(
            source="/data/render.001001.exr",
            output="/data/output.mov",
            profile=prores_profile,
        )
        i_idx = cmd.index("-i")
        assert "%06d" in cmd[i_idx + 1]
        assert cmd[cmd.index("-start_number") + 1] == "1001"

    def test_non_sequence_video_file(self, transcoder, prores_profile):
        cmd = transcoder.build_command(
            source="/data/clip.mov",
            output="/data/output.mov",
            profile=prores_profile,
        )
        assert "image2" not in cmd


class TestBuildCommandFilters:
    def test_lut_filter(self, transcoder, prores_profile):
        cmd = transcoder.build_command(
            source="/data/input.mov",
            output="/data/output.mov",
            profile=prores_profile,
            lut_path="/luts/show_lut.cube",
        )
        vf_idx = cmd.index("-vf")
        assert "lut3d=" in cmd[vf_idx + 1]
        assert "show_lut.cube" in cmd[vf_idx + 1]

    def test_burn_in_text(self, transcoder, prores_profile):
        cmd = transcoder.build_command(
            source="/data/input.mov",
            output="/data/output.mov",
            profile=prores_profile,
            burn_in_text="INTERNAL REVIEW",
        )
        vf_idx = cmd.index("-vf")
        assert "drawtext=" in cmd[vf_idx + 1]
        assert "INTERNAL REVIEW" in cmd[vf_idx + 1]

    def test_lut_and_burn_in_combined(self, transcoder, prores_profile):
        cmd = transcoder.build_command(
            source="/data/input.mov",
            output="/data/output.mov",
            profile=prores_profile,
            lut_path="/luts/show.cube",
            burn_in_text="DAILIES",
        )
        vf_idx = cmd.index("-vf")
        filter_str = cmd[vf_idx + 1]
        assert "lut3d=" in filter_str
        assert "drawtext=" in filter_str
        # LUT should come before burn-in
        assert filter_str.index("lut3d") < filter_str.index("drawtext")

    def test_no_filters_when_none(self, transcoder, prores_profile):
        cmd = transcoder.build_command(
            source="/data/input.mov",
            output="/data/output.mov",
            profile=prores_profile,
        )
        assert "-vf" not in cmd


class TestBuildCommandAudio:
    def test_audio_source_mux(self, transcoder, prores_profile):
        cmd = transcoder.build_command(
            source="/data/input.mov",
            output="/data/output.mov",
            profile=prores_profile,
            audio_source="/data/audio.wav",
        )
        # Should have two -i inputs
        i_indices = [i for i, v in enumerate(cmd) if v == "-i"]
        assert len(i_indices) == 2
        assert cmd[i_indices[1] + 1] == "/data/audio.wav"
        assert cmd[cmd.index("-c:a") + 1] == "pcm_s24le"

    def test_image_seq_no_audio_gets_an(self, transcoder, prores_profile):
        cmd = transcoder.build_command(
            source="/data/render.1001.exr",
            output="/data/output.mov",
            profile=prores_profile,
        )
        assert "-an" in cmd

    def test_image_seq_with_audio_source(self, transcoder, prores_profile):
        cmd = transcoder.build_command(
            source="/data/render.1001.exr",
            output="/data/output.mov",
            profile=prores_profile,
            audio_source="/data/audio.wav",
        )
        assert "-an" not in cmd
        assert cmd[cmd.index("-c:a") + 1] == "pcm_s24le"


class TestBuildCommandTimecode:
    def test_timecode_start(self, transcoder, prores_profile):
        cmd = transcoder.build_command(
            source="/data/input.mov",
            output="/data/output.mov",
            profile=prores_profile,
            timecode_start="01:00:00:00",
        )
        assert cmd[cmd.index("-timecode") + 1] == "01:00:00:00"

    def test_no_timecode_when_none(self, transcoder, prores_profile):
        cmd = transcoder.build_command(
            source="/data/input.mov",
            output="/data/output.mov",
            profile=prores_profile,
        )
        assert "-timecode" not in cmd


class TestValidateFFmpeg:
    @patch("shutil.which", return_value=None)
    def test_missing_ffmpeg_raises(self, mock_which, transcoder):
        with pytest.raises(TranscodeError, match="not found in PATH"):
            transcoder.validate_ffmpeg()

    @patch("shutil.which", return_value="/usr/bin/ffmpeg")
    def test_ffmpeg_found(self, mock_which, transcoder):
        transcoder.validate_ffmpeg()  # Should not raise


class TestTranscode:
    @patch("shutil.which", return_value="/usr/bin/ffmpeg")
    @patch("subprocess.run")
    def test_success(self, mock_run, mock_which, transcoder, prores_profile):
        mock_run.return_value = type("Result", (), {"returncode": 0, "stderr": ""})()
        result = transcoder.transcode(
            source="/data/input.mov",
            output="/data/output.mov",
            profile=prores_profile,
        )
        assert result.output_path == "/data/output.mov"
        assert result.codec == "prores_ks"
        assert result.container == "mov"

    @patch("shutil.which", return_value="/usr/bin/ffmpeg")
    @patch("subprocess.run")
    def test_ffmpeg_failure(self, mock_run, mock_which, transcoder, prores_profile):
        mock_run.return_value = type("Result", (), {"returncode": 1, "stderr": "codec error"})()
        with pytest.raises(TranscodeError, match="FFmpeg failed"):
            transcoder.transcode(
                source="/data/input.mov",
                output="/data/output.mov",
                profile=prores_profile,
            )
