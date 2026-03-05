import subprocess
import shutil
from pathlib import Path
from dataclasses import dataclass


class OiioError(Exception):
    pass


@dataclass
class OiioProcessor:
    oiiotool_bin: str = "oiiotool"

    def generate_thumbnail(self, source: str, output: str, width: int = 256, height: int = 256) -> None:
        """Generate a JPEG thumbnail from an EXR/DPX source."""
        if not Path(source).exists():
            raise OiioError(f"Source file not found: {source}")
        cmd = self._build_thumbnail_cmd(source, output, width, height)
        self._run(cmd)

    def generate_proxy(self, source: str, output: str, width: int = 1920, height: int = 1080) -> None:
        """Generate an H.264 proxy MP4 from an EXR/DPX source.

        Uses oiiotool to extract frames, then ffmpeg to encode H.264.
        """
        if not Path(source).exists():
            raise OiioError(f"Source file not found: {source}")
        if not shutil.which("ffmpeg"):
            raise OiioError("ffmpeg not found in PATH — required for proxy encoding")

        # For single frames: convert to PNG intermediate, then encode with ffmpeg
        intermediate = output.replace(".mp4", "_intermediate.png")
        resize_cmd = self._build_thumbnail_cmd(source, intermediate, width, height)
        self._run(resize_cmd)

        ffmpeg_cmd = [
            "ffmpeg", "-y",
            "-i", intermediate,
            "-c:v", "libx264",
            "-preset", "fast",
            "-crf", "23",
            "-pix_fmt", "yuv420p",
            output,
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
        result = subprocess.run(cmd, capture_output=True, text=True)
        if result.returncode != 0:
            raise OiioError(f"oiiotool failed: {result.stderr}")
