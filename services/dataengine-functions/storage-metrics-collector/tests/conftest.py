"""Pytest configuration for storage-metrics-collector tests.

Sets permissive base directories for test execution.
"""

import os

os.environ.setdefault("SPACEHARBOR_MEDIA_BASE_DIR", "/")
