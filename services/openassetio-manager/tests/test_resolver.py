import pytest
from unittest.mock import patch, MagicMock
from src.resolver import VastResolver, AssetNotFoundError


def test_resolve_returns_uri_for_known_asset_dev_mode():
    resolver = VastResolver(trino_host="localhost", trino_port=8080, dev_mode=True)
    uri = resolver.resolve("asset:abc123")
    assert uri.startswith("mock://")


def test_resolve_raises_for_unknown_asset_dev_mode():
    resolver = VastResolver(trino_host="localhost", trino_port=8080, dev_mode=True)
    with pytest.raises(AssetNotFoundError):
        resolver.resolve("asset:NONEXISTENT_XYZ_999")


def test_resolve_dev_mode_does_not_call_http():
    resolver = VastResolver(trino_host="localhost", trino_port=8080, dev_mode=True)
    with patch("src.resolver.requests.get") as mock_get:
        resolver.resolve("asset:abc123")
        mock_get.assert_not_called()


@patch.dict("os.environ", {"ASSETHARBOR_CONTROL_PLANE_URL": "http://control-plane:8080"})
def test_resolve_queries_control_plane():
    resolver = VastResolver()
    mock_resp = MagicMock()
    mock_resp.json.return_value = {"id": "abc123", "sourceUri": "vast://bucket/abc123.exr"}
    mock_resp.raise_for_status.return_value = None

    with patch("src.resolver.requests.get", return_value=mock_resp) as mock_get:
        uri = resolver.resolve("asset:abc123")
        assert uri == "vast://bucket/abc123.exr"
        mock_get.assert_called_once()


def test_register_dev_mode():
    resolver = VastResolver(dev_mode=True)
    result = resolver.register("asset:new123", {"title": "Test", "sourceUri": "/test.exr"})
    assert result["status"] == "registered"
    # Should be resolvable now
    uri = resolver.resolve("asset:new123")
    assert uri == "/test.exr"


@patch.dict("os.environ", {"ASSETHARBOR_CONTROL_PLANE_URL": "http://control-plane:8080"})
def test_register_queries_control_plane():
    resolver = VastResolver()
    mock_resp = MagicMock()
    mock_resp.json.return_value = {"asset": {"id": "new123"}, "job": {"id": "j1"}}
    mock_resp.raise_for_status.return_value = None

    with patch("src.resolver.requests.post", return_value=mock_resp):
        result = resolver.register("asset:new123", {"title": "Test", "sourceUri": "/test.exr"})
        assert "asset" in result


def test_fallback_to_in_memory_when_no_url():
    """With no ASSETHARBOR_CONTROL_PLANE_URL, resolver uses dev mode."""
    with patch.dict("os.environ", {}, clear=True):
        resolver = VastResolver()
        assert resolver.dev_mode is True
        uri = resolver.resolve("asset:abc123")
        assert "abc123" in uri


def test_list_assets_dev_mode():
    resolver = VastResolver(dev_mode=True)
    assets = resolver.list_assets(shot_id="sh010")
    assert len(assets) == 2
    assert assets[0]["shot_id"] == "sh010"


def test_browse_dev_mode():
    resolver = VastResolver(dev_mode=True)
    results = resolver.browse("asset:all")
    assert len(results) == 2
