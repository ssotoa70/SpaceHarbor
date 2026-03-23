"""VAST DataEngine entrypoint for ffmpeg-transcoder.

Called by VAST DataEngine when a media file needs delivery transcoding.

Environment variables:
  VAST_SOURCE_PATH   - NFS path to the source media file (set by DataEngine)
  VAST_ASSET_ID      - SpaceHarbor asset ID (set by DataEngine pipeline config)
  VAST_OUTPUT_PATH   - NFS path for the transcoded output file
  TRANSCODE_PROFILE  - Name of the transcode profile to use (default: h264_review)
  KAFKA_BROKER       - Kafka broker address (optional; skips publish if unset)

Optional:
  LUT_PATH           - Path to a 3D LUT file for baked color transforms
  AUDIO_SOURCE_PATH  - Path to a separate audio file for dual-system audio mux
  TIMECODE_START     - Starting timecode (HH:MM:SS:FF)
  BURN_IN_TEXT       - Text to burn into the video (e.g., "INTERNAL REVIEW ONLY")
  FRAMERATE          - Frame rate for image sequences (default: 24.0)
"""

import logging
import os
import sys

from src.transcoder import Transcoder, TranscodeError
from src.profiles import load_profile, ProfileError

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", ".."))
from shared.cloudevent_publisher import publish_completion
from shared.input_validation import (
    InputValidationError,
    validate_asset_id,
    validate_media_path,
    validate_timecode,
)

logging.basicConfig(level=logging.INFO, format="%(levelname)s %(message)s")
log = logging.getLogger("ffmpeg-transcoder")


def main() -> int:
    source_path = os.environ.get("VAST_SOURCE_PATH", "")
    asset_id = os.environ.get("VAST_ASSET_ID", "")
    output_path = os.environ.get("VAST_OUTPUT_PATH", "")
    profile_name = os.environ.get("TRANSCODE_PROFILE", "h264_review")

    log.info(f"Transcoding asset {asset_id}: {source_path} -> {output_path} [{profile_name}]")

    if not source_path or not asset_id or not output_path:
        log.error("VAST_SOURCE_PATH, VAST_ASSET_ID, and VAST_OUTPUT_PATH must be set")
        return 1

    # Validate required inputs
    try:
        validate_asset_id(asset_id)
        validate_media_path(source_path, label="Source path")
        validate_media_path(output_path, label="Output path")
    except InputValidationError as e:
        log.error(f"Input validation failed: {e}")
        return 1

    # Optional parameters
    lut_path = os.environ.get("LUT_PATH") or None
    audio_source = os.environ.get("AUDIO_SOURCE_PATH") or None
    timecode_start = os.environ.get("TIMECODE_START") or None
    burn_in_text = os.environ.get("BURN_IN_TEXT") or None
    framerate = float(os.environ.get("FRAMERATE", "24.0"))

    # Validate optional inputs
    try:
        if audio_source:
            validate_media_path(audio_source, label="Audio source path")
        if timecode_start:
            validate_timecode(timecode_start)
        # burn_in_text and lut_path are validated inside Transcoder._build_filters
    except InputValidationError as e:
        log.error(f"Input validation failed: {e}")
        return 1

    try:
        profile = load_profile(profile_name)
    except ProfileError as e:
        log.error(f"Profile error: {e}")
        publish_completion(
            function_name="ffmpeg_transcoder",
            asset_id=asset_id,
            success=False,
            error=str(e),
        )
        return 1

    try:
        transcoder = Transcoder()
        result = transcoder.transcode(
            source=source_path,
            output=output_path,
            profile=profile,
            lut_path=lut_path,
            burn_in_text=burn_in_text,
            audio_source=audio_source,
            timecode_start=timecode_start,
            framerate=framerate,
        )
        log.info(f"Transcode complete: {result.output_path}")
        publish_completion(
            function_name="ffmpeg_transcoder",
            asset_id=asset_id,
            success=True,
            metadata={
                "output_path": result.output_path,
                "codec": result.codec,
                "container": result.container,
                "profile": profile_name,
            },
        )
        return 0
    except TranscodeError as e:
        log.error(f"Transcode failed: {e}")
        publish_completion(
            function_name="ffmpeg_transcoder",
            asset_id=asset_id,
            success=False,
            error=str(e),
        )
        return 1
    except Exception as e:
        log.error(f"Unexpected error: {e}", exc_info=True)
        publish_completion(
            function_name="ffmpeg_transcoder",
            asset_id=asset_id,
            success=False,
            error=str(e),
        )
        return 1


if __name__ == "__main__":
    sys.exit(main())
