"""Tests for ffmpeg-transcoder DataEngine function entrypoint."""

import pytest
from unittest.mock import patch, MagicMock

from src.transcoder import TranscodeResult, TranscodeError


VALID_ENV = {
    "VAST_SOURCE_PATH": "/data/input.mov",
    "VAST_ASSET_ID": "asset-abc123",
    "VAST_OUTPUT_PATH": "/data/output.mov",
    "TRANSCODE_PROFILE": "prores_422_hq",
}


class TestMain:
    @patch.dict("os.environ", {}, clear=True)
    def test_missing_env_vars_returns_1(self):
        from src.function import main
        assert main() == 1

    @patch.dict("os.environ", {"VAST_SOURCE_PATH": "/data/in.mov", "VAST_ASSET_ID": "a1"}, clear=True)
    def test_missing_output_path_returns_1(self):
        from src.function import main
        assert main() == 1

    @patch.dict("os.environ", {"VAST_SOURCE_PATH": "/data/in.mov", "VAST_OUTPUT_PATH": "/data/out.mov"}, clear=True)
    def test_missing_asset_id_returns_1(self):
        from src.function import main
        assert main() == 1

    @patch("src.function.publish_completion")
    @patch("src.function.Transcoder")
    @patch("src.function.load_profile")
    @patch.dict("os.environ", VALID_ENV)
    def test_success_publishes_metadata(self, mock_load, mock_cls, mock_publish):
        mock_profile = MagicMock()
        mock_load.return_value = mock_profile
        mock_instance = mock_cls.return_value
        mock_instance.transcode.return_value = TranscodeResult(
            output_path="/data/output.mov",
            codec="prores_ks",
            container="mov",
        )
        from src.function import main
        assert main() == 0
        mock_publish.assert_called_once_with(
            function_name="ffmpeg_transcoder",
            asset_id="asset-abc123",
            success=True,
            metadata={
                "output_path": "/data/output.mov",
                "codec": "prores_ks",
                "container": "mov",
                "profile": "prores_422_hq",
            },
        )

    @patch("src.function.publish_completion")
    @patch("src.function.Transcoder")
    @patch("src.function.load_profile")
    @patch.dict("os.environ", VALID_ENV)
    def test_transcode_error_publishes_failure(self, mock_load, mock_cls, mock_publish):
        mock_load.return_value = MagicMock()
        mock_instance = mock_cls.return_value
        mock_instance.transcode.side_effect = TranscodeError("codec not available")
        from src.function import main
        assert main() == 1
        mock_publish.assert_called_once_with(
            function_name="ffmpeg_transcoder",
            asset_id="asset-abc123",
            success=False,
            error="codec not available",
        )

    @patch("src.function.publish_completion")
    @patch("src.function.load_profile")
    @patch.dict("os.environ", {**VALID_ENV, "TRANSCODE_PROFILE": "nonexistent"})
    def test_bad_profile_publishes_failure(self, mock_load, mock_publish):
        from src.profiles import ProfileError
        mock_load.side_effect = ProfileError("Profile 'nonexistent' not found")
        from src.function import main
        assert main() == 1
        mock_publish.assert_called_once()
        call_kwargs = mock_publish.call_args[1]
        assert call_kwargs["success"] is False
        assert "not found" in call_kwargs["error"]

    @patch("src.function.publish_completion")
    @patch("src.function.Transcoder")
    @patch("src.function.load_profile")
    @patch.dict("os.environ", VALID_ENV)
    def test_unexpected_error_publishes_failure(self, mock_load, mock_cls, mock_publish):
        mock_load.return_value = MagicMock()
        mock_instance = mock_cls.return_value
        mock_instance.transcode.side_effect = RuntimeError("disk full")
        from src.function import main
        assert main() == 1
        mock_publish.assert_called_once_with(
            function_name="ffmpeg_transcoder",
            asset_id="asset-abc123",
            success=False,
            error="disk full",
        )

    @patch("src.function.publish_completion")
    @patch("src.function.Transcoder")
    @patch("src.function.load_profile")
    @patch.dict("os.environ", {
        **VALID_ENV,
        "LUT_PATH": "/luts/show.cube",
        "AUDIO_SOURCE_PATH": "/data/audio.wav",
        "TIMECODE_START": "01:00:00:00",
        "BURN_IN_TEXT": "REVIEW",
        "FRAMERATE": "25.0",
    })
    def test_optional_params_passed(self, mock_load, mock_cls, mock_publish):
        mock_profile = MagicMock()
        mock_load.return_value = mock_profile
        mock_instance = mock_cls.return_value
        mock_instance.transcode.return_value = TranscodeResult(
            output_path="/data/output.mov",
            codec="prores_ks",
            container="mov",
        )
        from src.function import main
        assert main() == 0
        call_kwargs = mock_instance.transcode.call_args[1]
        assert call_kwargs["lut_path"] == "/luts/show.cube"
        assert call_kwargs["audio_source"] == "/data/audio.wav"
        assert call_kwargs["timecode_start"] == "01:00:00:00"
        assert call_kwargs["burn_in_text"] == "REVIEW"
        assert call_kwargs["framerate"] == 25.0
