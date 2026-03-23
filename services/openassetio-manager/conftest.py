"""Root conftest — set DEV_MODE before any module imports."""
import os

os.environ.setdefault("DEV_MODE", "true")
