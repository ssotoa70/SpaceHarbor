import pytest
from unittest.mock import patch, MagicMock
from src.resolver import VastResolver, AssetNotFoundError, HAS_HTTPX

# Patch the HTTP module actually imported by the resolver (httpx if available, else requests)
_HTTP_MOD = "src.resolver.httpx" if HAS_HTTPX else "src.resolver.requests"


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
    with patch(f"{_HTTP_MOD}.get") as mock_get:
        resolver.resolve("asset:abc123")
        mock_get.assert_not_called()


@patch.dict("os.environ", {"SPACEHARBOR_CONTROL_PLANE_URL": "http://control-plane:8080"})
def test_resolve_queries_control_plane():
    resolver = VastResolver()
    mock_resp = MagicMock()
    mock_resp.json.return_value = {"id": "abc123", "sourceUri": "vast://bucket/abc123.exr"}
    mock_resp.raise_for_status.return_value = None

    with patch(f"{_HTTP_MOD}.get", return_value=mock_resp) as mock_get:
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


@patch.dict("os.environ", {"SPACEHARBOR_CONTROL_PLANE_URL": "http://control-plane:8080"})
def test_register_queries_control_plane():
    resolver = VastResolver()
    mock_resp = MagicMock()
    mock_resp.json.return_value = {"asset": {"id": "new123"}, "job": {"id": "j1"}}
    mock_resp.raise_for_status.return_value = None

    with patch(f"{_HTTP_MOD}.post", return_value=mock_resp):
        result = resolver.register("asset:new123", {"title": "Test", "sourceUri": "/test.exr"})
        assert "asset" in result


def test_fallback_to_in_memory_when_no_url():
    """With no SPACEHARBOR_CONTROL_PLANE_URL, resolver uses dev mode."""
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


@patch.dict("os.environ", {"SPACEHARBOR_CONTROL_PLANE_URL": "http://control-plane:8080"})
def test_resolve_raises_on_http_404():
    """HTTP 404 from control-plane raises AssetNotFoundError."""
    resolver = VastResolver()

    if HAS_HTTPX:
        import httpx
        exc = httpx.HTTPStatusError(
            "404 Not Found",
            request=MagicMock(),
            response=MagicMock(status_code=404),
        )
    else:
        from requests.exceptions import HTTPError
        exc = HTTPError("404 Not Found")

    with patch(f"{_HTTP_MOD}.get", side_effect=exc):
        with pytest.raises(AssetNotFoundError):
            resolver.resolve("asset:nonexistent")


@patch.dict("os.environ", {"SPACEHARBOR_CONTROL_PLANE_URL": "http://control-plane:8080"})
def test_resolve_raises_on_connection_error():
    """Connection failure raises AssetNotFoundError."""
    resolver = VastResolver()
    with patch(f"{_HTTP_MOD}.get", side_effect=ConnectionError("refused")):
        with pytest.raises(AssetNotFoundError):
            resolver.resolve("asset:abc123")


@patch.dict("os.environ", {"SPACEHARBOR_CONTROL_PLANE_URL": "http://control-plane:8080"})
def test_browse_queries_control_plane_for_assets():
    """browse('asset:all') queries /api/v1/assets."""
    resolver = VastResolver()
    mock_resp = MagicMock()
    mock_resp.json.return_value = [
        {"id": "a1", "name": "plate.exr"},
        {"id": "a2", "name": "plate.mov"},
    ]
    mock_resp.raise_for_status.return_value = None

    with patch(f"{_HTTP_MOD}.get", return_value=mock_resp) as mock_get:
        results = resolver.browse("asset:all")
        assert len(results) == 2
        call_args = mock_get.call_args
        url = call_args[0][0] if call_args[0] else call_args.kwargs.get("url", "")
        assert url.endswith("/api/v1/assets")


@patch.dict("os.environ", {"SPACEHARBOR_CONTROL_PLANE_URL": "http://control-plane:8080"})
def test_browse_queries_timelines_endpoint():
    """browse('timeline:all') queries /api/v1/timelines."""
    resolver = VastResolver()
    mock_resp = MagicMock()
    mock_resp.json.return_value = [{"id": "t1", "name": "edit_v3"}]
    mock_resp.raise_for_status.return_value = None

    with patch(f"{_HTTP_MOD}.get", return_value=mock_resp) as mock_get:
        results = resolver.browse("timeline:all")
        assert len(results) == 1
        call_args = mock_get.call_args
        url = call_args[0][0] if call_args[0] else call_args.kwargs.get("url", "")
        assert url.endswith("/api/v1/timelines")


def test_startup_fails_without_control_plane_url_in_prod_mode():
    """A.2: DEV_MODE=false without SPACEHARBOR_CONTROL_PLANE_URL must raise ValueError."""
    import importlib
    env = {"DEV_MODE": "false"}
    with patch.dict("os.environ", env, clear=True):
        with pytest.raises(ValueError, match="SPACEHARBOR_CONTROL_PLANE_URL is not set"):
            import src.routes.manager as mgr
            importlib.reload(mgr)
