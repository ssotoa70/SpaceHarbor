import pytest
from httpx import AsyncClient, ASGITransport
from src.main import app


@pytest.mark.asyncio
async def test_resolve_known_asset():
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
        response = await client.post("/resolve", json={"entity_ref": "asset:abc123"})
    assert response.status_code == 200
    body = response.json()
    assert "uri" in body
    assert body["uri"].startswith("mock://") or body["uri"].startswith("vast://")


@pytest.mark.asyncio
async def test_resolve_unknown_asset_returns_404():
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
        response = await client.post("/resolve", json={"entity_ref": "asset:NONEXISTENT"})
    assert response.status_code == 404
    assert "not found" in response.json()["detail"].lower()


@pytest.mark.asyncio
async def test_resolve_missing_body_returns_422():
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
        response = await client.post("/resolve", json={})
    assert response.status_code == 422
