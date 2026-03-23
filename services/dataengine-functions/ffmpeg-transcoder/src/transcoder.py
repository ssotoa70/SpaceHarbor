"""Core transcoding logic wrapping FFmpeg subprocess calls.

Builds FFmpeg command lines from TranscodeProfile presets and handles
single video files, EXR/DPX image sequences, LUT application,
text burn-in, and audio muxing.
"""

import logging
import os
import re
import shutil
import subprocess
import sys
from dataclasses import dataclass
from pathlib import Path

from src.profiles import TranscodeProfile

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", ".."))
from shared.input_validation import (
    InputValidationError,
    validate_burn_in_text,
    validate_lut_path,
)

log = logging.getLogger("ffmpeg-transcoder")

IMAGE_SEQ_EXTENSIONS = {".exr", ".dpx", ".tif", ".tiff", ".png", ".jpg", ".jpeg"}
FRAME_PATTERN = re.compile(r"^(.+?)(\d{3,8})(\.\w+)$")


class TranscodeError(Exception):
    pass


@dataclass
class TranscodeResult:
    output_path: str
    codec: str
    container: str
    duration_seconds: float | None = None


class Transcoder:
    """Wraps FFmpeg subprocess calls for delivery transcoding."""

    def __init__(self, ffmpeg_bin: str = "ffmpeg"):
        self.ffmpeg_bin = ffmpeg_bin

    def validate_ffmpeg(self) -> None:
        """Check that FFmpeg is available in PATH."""
        if not shutil.which(self.ffmpeg_bin):
            raise TranscodeError(
                f"{self.ffmpeg_bin} not found in PATH — required for transcoding"
            )

    def transcode(
        self,
        source: str,
        output: str,
        profile: TranscodeProfile,
        lut_path: str | None = None,
        burn_in_text: str | None = None,
        audio_source: str | None = None,
        timecode_start: str | None = None,
        framerate: float = 24.0,
    ) -> TranscodeResult:
        """Run FFmpeg transcode with the given profile.

        Args:
            source: Input file path or image sequence frame path
            output: Output file path
            profile: TranscodeProfile with codec/container settings
            lut_path: Optional 3D LUT file for baked color
            burn_in_text: Optional text to burn into the video
            audio_source: Optional separate audio file to mux
            timecode_start: Optional starting timecode (HH:MM:SS:FF)
            framerate: Frame rate for image sequences (default 24.0)

        Returns:
            TranscodeResult with output info

        Raises:
            TranscodeError: If FFmpeg fails or is not available
        """
        self.validate_ffmpeg()

        cmd = self.build_command(
            source=source,
            output=output,
            profile=profile,
            lut_path=lut_path,
            burn_in_text=burn_in_text,
            audio_source=audio_source,
            timecode_start=timecode_start,
            framerate=framerate,
        )

        log.info(f"Running: {' '.join(cmd)}")
        timeout = int(os.environ.get("FFMPEG_TIMEOUT", "3600"))
        try:
            result = subprocess.run(cmd, capture_output=True, text=True, timeout=timeout)
        except subprocess.TimeoutExpired:
            raise TranscodeError(f"FFmpeg timed out after {timeout}s processing {source}")
        if result.returncode != 0:
            raise TranscodeError(f"FFmpeg failed (exit {result.returncode}): {result.stderr}")

        return TranscodeResult(
            output_path=output,
            codec=profile.codec,
            container=profile.container,
        )

    def build_command(
        self,
        source: str,
        output: str,
        profile: TranscodeProfile,
        lut_path: str | None = None,
        burn_in_text: str | None = None,
        audio_source: str | None = None,
        timecode_start: str | None = None,
        framerate: float = 24.0,
    ) -> list[str]:
        """Build the FFmpeg command list without executing it.

        This method is the primary testing seam — tests can inspect the
        generated command without actually running FFmpeg.
        """
        cmd: list[str] = [self.ffmpeg_bin, "-y"]

        # Input handling
        is_seq = self._is_image_sequence(source)
        if is_seq:
            seq_pattern = self._to_sequence_pattern(source)
            start_number = self._detect_start_number(source)
            cmd.extend([
                "-f", "image2",
                "-framerate", str(framerate),
                "-start_number", str(start_number),
                "-i", seq_pattern,
            ])
        else:
            cmd.extend(["-i", source])

        # Audio input
        if audio_source:
            cmd.extend(["-i", audio_source])

        # Build video filter chain
        filters = self._build_filters(lut_path, burn_in_text, profile)
        if filters:
            cmd.extend(["-vf", ",".join(filters)])

        # Video codec + params
        cmd.extend(["-c:v", profile.codec])
        cmd.extend(["-pix_fmt", profile.pixel_format])

        for key, val in profile.codec_params.items():
            cmd.extend([f"-{key}", val])

        # Resolution
        if profile.default_resolution:
            cmd.extend(["-s", profile.default_resolution])

        # Audio codec
        if audio_source:
            cmd.extend(["-c:a", profile.audio_codec])
            for key, val in profile.audio_params.items():
                cmd.extend([f"-{key}", val])
        elif not is_seq:
            cmd.extend(["-c:a", profile.audio_codec])
        else:
            cmd.extend(["-an"])

        # Timecode
        if timecode_start:
            cmd.extend(["-timecode", timecode_start])

        # Container format
        cmd.extend(["-f", profile.container])
        cmd.append(output)

        return cmd

    def _is_image_sequence(self, source: str) -> bool:
        """Detect if source is part of an image sequence."""
        path = Path(source)
        if path.suffix.lower() not in IMAGE_SEQ_EXTENSIONS:
            return False
        return bool(FRAME_PATTERN.match(path.name))

    def _to_sequence_pattern(self, source: str) -> str:
        """Convert a single frame path to an FFmpeg sequence pattern.

        e.g. render.1001.exr -> render.%04d.exr
        """
        path = Path(source)
        match = FRAME_PATTERN.match(path.name)
        if not match:
            return source
        prefix, digits, ext = match.groups()
        pattern = f"{prefix}%0{len(digits)}d{ext}"
        return str(path.parent / pattern)

    def _detect_start_number(self, source: str) -> int:
        """Extract the frame number from a sequence frame path."""
        path = Path(source)
        match = FRAME_PATTERN.match(path.name)
        if not match:
            return 0
        return int(match.group(2))

    def _build_filters(
        self,
        lut_path: str | None,
        burn_in_text: str | None,
        profile: TranscodeProfile,
    ) -> list[str]:
        """Build the FFmpeg video filter chain.

        Raises:
            TranscodeError: If lut_path or burn_in_text fail validation.
        """
        filters: list[str] = []

        if lut_path:
            try:
                validated_lut = validate_lut_path(lut_path)
            except InputValidationError as e:
                raise TranscodeError(f"Invalid LUT path: {e}")
            escaped = validated_lut.replace("'", r"\'").replace(":", r"\:")
            filters.append(f"lut3d='{escaped}'")

        if burn_in_text:
            try:
                validate_burn_in_text(burn_in_text)
            except InputValidationError as e:
                raise TranscodeError(f"Invalid burn-in text: {e}")
            escaped = burn_in_text.replace("'", r"\'").replace(":", r"\:")
            filters.append(
                f"drawtext=text='{escaped}'"
                ":fontsize=24:fontcolor=white"
                ":x=10:y=h-40"
                ":box=1:boxcolor=black@0.6:boxborderw=4"
            )

        return filters
