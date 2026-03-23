"""Pytest configuration for provenance-recorder tests.

Sets permissive base directories so unit tests with synthetic paths
pass validation. Production deployments use restrictive defaults.
"""

import os

os.environ.setdefault("SPACEHARBOR_MEDIA_BASE_DIR", "/")
os.environ.setdefault("SPACEHARBOR_LUT_BASE_DIR", "/")
