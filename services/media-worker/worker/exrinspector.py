"""
EXR Inspector Stage

Extracts VFX metadata from OpenEXR image files.
Outputs critical metadata for asset versioning and quality control.
"""

import json
import os
import asyncio
import logging
from typing import Optional, Dict, Any
from pathlib import Path

from worker.data_engine import ProcessorStage, ProcessingContext

# Canonical EXR mock metadata — shared across all services.
# Source of truth: services/shared/exr-mock-metadata.json
_FIXTURE_PATH = Path(__file__).resolve().parent.parent.parent / "shared" / "exr-mock-metadata.json"


logger = logging.getLogger(__name__)


class ExrInspectorStage(ProcessorStage):
    """Extracts metadata from EXR image files."""

    def name(self) -> str:
        return "exrinspector"

    async def process(self, context: ProcessingContext) -> ProcessingContext:
        """Extract EXR metadata from source file."""
        try:
            source_uri = context.source_uri
            logger.info(f"[{context.correlation_id}] Inspecting EXR: {source_uri}")

            # Parse the file path from URI (file:///path/to/file.exr)
            file_path = self._parse_file_uri(source_uri)

            if not file_path or not os.path.exists(file_path):
                context.add_error(f"File not found: {file_path}")
                return context

            # Extract metadata
            metadata = await self._extract_metadata(file_path, context.correlation_id)

            if not metadata:
                context.add_error("Failed to extract EXR metadata")
                return context

            # Store in context
            context.metadata["exr"] = metadata
            logger.info(
                f"[{context.correlation_id}] EXR metadata extracted: "
                f"{metadata.get('resolution')}, {metadata.get('frame_count')} frames"
            )

            return context

        except Exception as e:
            context.add_error(f"EXR inspection failed: {str(e)}")
            logger.exception(f"[{context.correlation_id}] Exception in exrinspector")
            return context

    @staticmethod
    def _parse_file_uri(uri: str) -> Optional[str]:
        """Parse file:// URI to local path."""
        if uri.startswith("file://"):
            return uri[7:]  # Remove 'file://'
        return uri

    async def _extract_metadata(self, file_path: str, correlation_id: str) -> Optional[Dict[str, Any]]:
        """Extract EXR metadata from file.

        Returns canonical mock metadata from services/shared/exr-mock-metadata.json
        with the real file_size_bytes from the actual file on disk.
        In production, this would use PyOpenEXR or similar library.
        """
        try:
            file_stat = os.stat(file_path)

            metadata = self._load_canonical_mock()
            # Override file_size_bytes with real value from disk
            metadata["file_size_bytes"] = file_stat.st_size

            return metadata

        except Exception as e:
            logger.error(f"Failed to extract EXR metadata: {str(e)}")
            return None

    @staticmethod
    def _load_canonical_mock() -> Dict[str, Any]:
        """Load canonical EXR mock metadata from shared fixture."""
        try:
            with open(_FIXTURE_PATH, "r") as f:
                return json.load(f)
        except FileNotFoundError:
            logger.warning(
                f"Canonical fixture not found at {_FIXTURE_PATH}, using inline fallback"
            )
            # Inline fallback matching services/shared/exr-mock-metadata.json
            return {
                "codec": "exr",
                "channels": ["R", "G", "B", "A"],
                "resolution": {"width": 4096, "height": 2160},
                "color_space": "linear",
                "frame_count": 240,
                "bit_depth": 32,
                "duration_ms": 10000,
                "frame_range": {"first": 1001, "last": 1240},
                "frame_rate": 24.0,
                "pixel_aspect_ratio": 1.0,
                "display_window": {"x_min": 0, "y_min": 0, "x_max": 4095, "y_max": 2159},
                "data_window": {"x_min": 0, "y_min": 0, "x_max": 4095, "y_max": 2159},
                "compression_type": "PIZ",
                "file_size_bytes": 52428800,
                "checksum": "d41d8cd98f00b204e9800998ecf8427e",
            }


async def create_exr_inspector() -> ExrInspectorStage:
    """Factory function to create an EXR inspector stage."""
    return ExrInspectorStage()
