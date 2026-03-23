"""Tests for API key middleware (H16 security hardening)."""
import pytest
from unittest.mock import patch
from httpx import AsyncClient, ASGITransport
from src.main import app


@pytest.mark.asyncio
async def test_health_endpoint_bypasses_auth():
    """Health check should always be accessible, even with API key configured."""
    with patch.dict("os.environ", {"SPACEHARBOR_API_KEY": "secret-key-123"}):
        async with AsyncClient(
            transport=ASGITransport(app=app), base_url="http://test"
        ) as client:
            response = await client.get("/health")
        assert response.status_code == 200
        assert response.json()["status"] == "ok"


@pytest.mark.asyncio
async def test_no_api_key_configured_allows_all_requests():
    """When SPACEHARBOR_API_KEY is not set, all requests pass through (dev mode)."""
    with patch.dict("os.environ", {}, clear=False):
        # Ensure key is not set
        import os
        os.environ.pop("SPACEHARBOR_API_KEY", None)

        async with AsyncClient(
            transport=ASGITransport(app=app), base_url="http://test"
        ) as client:
            response = await client.get("/browse")
        assert response.status_code == 200


@pytest.mark.asyncio
async def test_valid_api_key_allows_request():
    """A valid x-api-key header should allow the request through."""
    with patch.dict("os.environ", {"SPACEHARBOR_API_KEY": "test-key-abc"}):
        async with AsyncClient(
            transport=ASGITransport(app=app), base_url="http://test"
        ) as client:
            response = await client.get(
                "/browse",
                headers={"x-api-key": "test-key-abc"},
            )
        assert response.status_code == 200


@pytest.mark.asyncio
async def test_missing_api_key_returns_401():
    """Missing x-api-key header should return 401 when API key is configured."""
    with patch.dict("os.environ", {"SPACEHARBOR_API_KEY": "secret-key-123"}):
        async with AsyncClient(
            transport=ASGITransport(app=app), base_url="http://test"
        ) as client:
            response = await client.get("/browse")
        assert response.status_code == 401
        assert "Missing x-api-key" in response.json()["detail"]


@pytest.mark.asyncio
async def test_invalid_api_key_returns_401():
    """An incorrect x-api-key should return 401."""
    with patch.dict("os.environ", {"SPACEHARBOR_API_KEY": "correct-key"}):
        async with AsyncClient(
            transport=ASGITransport(app=app), base_url="http://test"
        ) as client:
            response = await client.get(
                "/browse",
                headers={"x-api-key": "wrong-key"},
            )
        assert response.status_code == 401
        assert "Invalid API key" in response.json()["detail"]


@pytest.mark.asyncio
async def test_api_key_comparison_is_constant_time():
    """Verify the middleware uses hmac.compare_digest (not ==) for key comparison."""
    import hmac
    with patch.dict("os.environ", {"SPACEHARBOR_API_KEY": "test-key"}):
        with patch("src.main.hmac.compare_digest", wraps=hmac.compare_digest) as mock_cmp:
            async with AsyncClient(
                transport=ASGITransport(app=app), base_url="http://test"
            ) as client:
                await client.get(
                    "/browse",
                    headers={"x-api-key": "test-key"},
                )
            mock_cmp.assert_called_once_with("test-key", "test-key")


@pytest.mark.asyncio
async def test_post_resolve_requires_api_key():
    """POST /resolve should require API key when configured."""
    with patch.dict("os.environ", {"SPACEHARBOR_API_KEY": "my-key"}):
        async with AsyncClient(
            transport=ASGITransport(app=app), base_url="http://test"
        ) as client:
            # Without key — should be 401
            response = await client.post(
                "/resolve",
                json={"entity_ref": "asset:abc123"},
            )
            assert response.status_code == 401

            # With correct key — should succeed
            response = await client.post(
                "/resolve",
                json={"entity_ref": "asset:abc123"},
                headers={"x-api-key": "my-key"},
            )
            assert response.status_code == 200


@pytest.mark.asyncio
async def test_post_register_requires_api_key():
    """POST /register should require API key when configured."""
    with patch.dict("os.environ", {"SPACEHARBOR_API_KEY": "my-key"}):
        async with AsyncClient(
            transport=ASGITransport(app=app), base_url="http://test"
        ) as client:
            # Without key — should be 401
            response = await client.post(
                "/register",
                json={
                    "name": "test.exr",
                    "shot_id": "sh010",
                    "source_uri": "mock://test",
                    "version_label": "v001",
                },
            )
            assert response.status_code == 401

            # With correct key — should succeed
            response = await client.post(
                "/register",
                json={
                    "name": "test.exr",
                    "shot_id": "sh010",
                    "source_uri": "mock://test",
                    "version_label": "v001",
                },
                headers={"x-api-key": "my-key"},
            )
            assert response.status_code == 201


@pytest.mark.asyncio
async def test_empty_api_key_header_returns_401():
    """An empty x-api-key header should return 401."""
    with patch.dict("os.environ", {"SPACEHARBOR_API_KEY": "valid-key"}):
        async with AsyncClient(
            transport=ASGITransport(app=app), base_url="http://test"
        ) as client:
            response = await client.get(
                "/browse",
                headers={"x-api-key": ""},
            )
        assert response.status_code == 401
        assert "Missing x-api-key" in response.json()["detail"]
