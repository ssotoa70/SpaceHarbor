import pytest
from unittest.mock import patch
from src.resolver import VastResolver, AssetNotFoundError


def test_resolve_returns_vast_uri_for_known_asset():
    resolver = VastResolver(trino_host="localhost", trino_port=8080, dev_mode=True)
    uri = resolver.resolve("asset:abc123")
    assert uri.startswith("vast://") or uri.startswith("nfs://") or uri.startswith("mock://")


def test_resolve_raises_for_unknown_asset():
    resolver = VastResolver(trino_host="localhost", trino_port=8080, dev_mode=True)
    with pytest.raises(AssetNotFoundError):
        resolver.resolve("asset:NONEXISTENT_XYZ_999")


def test_resolve_dev_mode_does_not_call_trino():
    resolver = VastResolver(trino_host="localhost", trino_port=8080, dev_mode=True)
    with patch("src.resolver.requests.get") as mock_get:
        resolver.resolve("asset:abc123")
        mock_get.assert_not_called()
