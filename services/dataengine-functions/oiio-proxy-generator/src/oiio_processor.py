import os
import subprocess
import shutil
import sys
from pathlib import Path
from dataclasses import dataclass

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", ".."))
from shared.input_validation import InputValidationError, validate_path

# Configurable base directory for media files
_MEDIA_BASE_DIR = os.environ.get("SPACEHARBOR_MEDIA_BASE_DIR", "/data/media")


class OiioError(Exception):
    pass


def _validate_io_path(path: str, label: str) -> str:
    """Validate a file path for OIIO operations.

    Canonicalizes the path and ensures it is within the allowed
    media base directory, preventing path traversal attacks.

    Raises:
        OiioError: If validation fails.
    """
    try:
        return validate_path(path, _MEDIA_BASE_DIR, label=label)
    except InputValidationError as e:
        raise OiioError(f"Invalid {label.lower()}: {e}")


@dataclass
class OiioProcessor:
    oiiotool_bin: str = "oiiotool"

    def generate_thumbnail(self, source: str, output: str, width: int = 256, height: int = 256) -> None:
        """Generate a JPEG thumbnail from an EXR/DPX source."""
        validated_source = _validate_io_path(source, "Source path")
        validated_output = _validate_io_path(output, "Output path")
        if not Path(validated_source).exists():
            raise OiioError(f"Source file not found: {source}")
        cmd = self._build_thumbnail_cmd(validated_source, validated_output, width, height)
        self._run(cmd)

    def generate_proxy(self, source: str, output: str, width: int = 1920, height: int = 1080) -> None:
        """Generate an H.264 proxy MP4 from an EXR/DPX source.

        Uses oiiotool to extract frames, then ffmpeg to encode H.264.
        """
        validated_source = _validate_io_path(source, "Source path")
        validated_output = _validate_io_path(output, "Output path")
        if not Path(validated_source).exists():
            raise OiioError(f"Source file not found: {source}")
        if not shutil.which("ffmpeg"):
            raise OiioError("ffmpeg not found in PATH — required for proxy encoding")

        # For single frames: convert to PNG intermediate, then encode with ffmpeg
        intermediate = validated_output.replace(".mp4", "_intermediate.png")
        resize_cmd = self._build_thumbnail_cmd(validated_source, intermediate, width, height)
        self._run(resize_cmd)

        ffmpeg_cmd = [
            "ffmpeg", "-y",
            "-i", intermediate,
            "-c:v", "libx264",
            "-preset", "fast",
            "-crf", "23",
            "-pix_fmt", "yuv420p",
            validated_output,
        ]
        self._run(ffmpeg_cmd)
        Path(intermediate).unlink(missing_ok=True)

    def _build_thumbnail_cmd(self, source: str, output: str, width: int, height: int) -> list[str]:
        return [
            self.oiiotool_bin,
            source,
            "--resize", f"{width}x{height}",
            "--compression", "jpeg:85",
            "-o", output,
        ]

    def _run(self, cmd: list[str]) -> None:
        timeout = int(os.environ.get("OIIO_TIMEOUT", "300"))
        try:
            result = subprocess.run(cmd, capture_output=True, text=True, timeout=timeout)
        except subprocess.TimeoutExpired:
            raise OiioError(f"oiiotool timed out after {timeout}s running: {' '.join(cmd)}")
        if result.returncode != 0:
            raise OiioError(f"oiiotool failed: {result.stderr}")
