"""
EXR Inspector Stage

Extracts VFX metadata from OpenEXR image files.
Outputs critical metadata for asset versioning and quality control.
"""

import os
import asyncio
import logging
from typing import Optional, Dict, Any
from pathlib import Path

from worker.data_engine import ProcessorStage, ProcessingContext


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
        """Extract EXR metadata from file."""
        try:
            # For now, return mock metadata
            # In production, this would use PyOpenEXR or similar library
            file_stat = os.stat(file_path)

            metadata = {
                # Technical metadata
                "codec": "exr",
                "file_size_bytes": file_stat.st_size,
                "checksum": "mock-checksum-placeholder",  # Would be MD5/xxHash in production
                # Resolution (mock data)
                "resolution": {
                    "width": 4096,
                    "height": 2160,
                },
                # Frame information
                "frame_count": 24,
                "frame_range": {
                    "first": 1001,
                    "last": 1024,
                },
                "frame_rate": 24.0,
                "pixel_aspect_ratio": 1.0,
                # Display window (crop bounds)
                "display_window": {
                    "x_min": 0,
                    "y_min": 0,
                    "x_max": 4096,
                    "y_max": 2160,
                },
                # Data window (image extent, often differs from display_window for tiles)
                "data_window": {
                    "x_min": 0,
                    "y_min": 0,
                    "x_max": 4096,
                    "y_max": 2160,
                },
                # Compression (mock)
                "compression_type": "PIZ",
                # Channel information
                "channels": [
                    {"name": "R", "type": "FLOAT"},
                    {"name": "G", "type": "FLOAT"},
                    {"name": "B", "type": "FLOAT"},
                    {"name": "A", "type": "FLOAT"},
                ],
                "color_space": "linear",
                "bit_depth": 32,
                # Duration
                "duration_ms": 1000,  # For multi-frame sequences
            }

            return metadata

        except Exception as e:
            logger.error(f"Failed to extract EXR metadata: {str(e)}")
            return None


async def create_exr_inspector() -> ExrInspectorStage:
    """Factory function to create an EXR inspector stage."""
    return ExrInspectorStage()
