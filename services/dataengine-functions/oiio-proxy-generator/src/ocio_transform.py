import subprocess
import logging
import os
import shutil
from dataclasses import dataclass
from pathlib import Path

log = logging.getLogger("oiio-proxy-generator")


class ColorspaceDetectionError(Exception):
    pass


# Map EXR attribute values to OCIO colorspace names (ACES 1.3 config)
_COLORSPACE_MAP = {
    "logc": "ARRI LogC",
    "logc3": "ARRI LogC",
    "logc4": "ARRI LogC4",
    "acescg": "ACEScg",
    "aces": "ACEScg",
    "linear": "scene_linear",
    "scene_linear": "scene_linear",
    "srgb": "sRGB",
    "rec709": "Rec.709",
    "rec.709": "Rec.709",
}


@dataclass
class OcioTransform:
    config_path: str | None
    dev_mode: bool = False

    def __post_init__(self):
        if self.config_path is None:
            self.config_path = os.environ.get(
                "OCIO_CONFIG_PATH",
                "/usr/share/color/opencolorio/aces_1.3/config.ocio",
            )

    def apply(self, source: str, target_colorspace: str = "sRGB") -> str:
        """Apply OCIO color transform. In dev mode, returns source unchanged.

        Production: uses oiiotool --colorconvert to produce a color-correct
        intermediate file. Returns path to the transformed file.
        """
        if self.dev_mode:
            log.info(f"[DEV] OCIO transform skipped for {source}")
            return source

        if not Path(source).exists():
            raise FileNotFoundError(f"Source file not found: {source}")

        source_cs = self.detect_colorspace(source)
        if source_cs == target_colorspace:
            log.info(f"No transform needed: source is already {target_colorspace}")
            return source

        output = source.replace(".exr", f"__{target_colorspace.replace('.', '_')}.exr")
        self._run_colorconvert(source, output, source_cs, target_colorspace)
        return output

    def detect_colorspace(self, source: str) -> str:
        """Detect source colorspace from EXR metadata attributes."""
        metadata = self._read_exr_metadata(source)

        # Priority 1: explicit 'colorspace' attribute
        if cs_attr := metadata.get("colorspace"):
            return self._normalize_colorspace(str(cs_attr))

        # Priority 2: chromaticities heuristic
        if chroma := metadata.get("chromaticities", ""):
            chroma_lower = str(chroma).lower()
            if "aces" in chroma_lower:
                return "ACEScg"
            if "rec709" in chroma_lower or "rec.709" in chroma_lower:
                return "Rec.709"

        # Default: assume scene_linear for EXR without metadata
        return "scene_linear"

    def _normalize_colorspace(self, raw: str) -> str:
        return _COLORSPACE_MAP.get(raw.lower().strip(), raw)

    def _read_exr_metadata(self, source: str) -> dict:
        """Read EXR metadata using oiiotool --info -v."""
        if not shutil.which("oiiotool"):
            return {}
        result = subprocess.run(
            ["oiiotool", "--info", "-v", source],
            capture_output=True,
            text=True,
        )
        metadata = {}
        for line in result.stdout.splitlines():
            if ":" in line:
                key, _, value = line.partition(":")
                metadata[key.strip().lower()] = value.strip()
        return metadata

    def _run_colorconvert(self, source: str, output: str, from_cs: str, to_cs: str) -> None:
        """Run oiiotool --colorconvert with OCIO config."""
        env = os.environ.copy()
        env["OCIO"] = self.config_path
        cmd = [
            "oiiotool", source,
            "--colorconvert", from_cs, to_cs,
            "-o", output,
        ]
        result = subprocess.run(cmd, capture_output=True, text=True, env=env)
        if result.returncode != 0:
            raise ColorspaceDetectionError(
                f"oiiotool colorconvert failed: {result.stderr}"
            )
        log.info(f"OCIO transform: {from_cs} → {to_cs} → {output}")
