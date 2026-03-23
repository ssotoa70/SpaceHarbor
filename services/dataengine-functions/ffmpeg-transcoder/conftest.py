"""Pytest configuration for ffmpeg-transcoder tests.

Sets permissive base directories so unit tests with synthetic paths
(e.g., /data/input.mov, /luts/show.cube) pass validation.
Production deployments use restrictive defaults (/data/media, /data/luts).
"""

import os

os.environ.setdefault("SPACEHARBOR_MEDIA_BASE_DIR", "/")
os.environ.setdefault("SPACEHARBOR_LUT_BASE_DIR", "/")
