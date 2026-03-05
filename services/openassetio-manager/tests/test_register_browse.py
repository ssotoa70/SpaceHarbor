import pytest
from httpx import AsyncClient, ASGITransport
from src.main import app


@pytest.mark.asyncio
async def test_register_asset_returns_entity_ref():
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
        response = await client.post("/register", json={
            "name": "hero_plate_v003.exr",
            "shot_id": "sh010",
            "source_uri": "mock://vast/ingest/ghi789/hero_plate_v003.exr",
            "version_label": "v003",
        })
    assert response.status_code == 201
    body = response.json()
    assert "entity_ref" in body
    assert body["entity_ref"].startswith("asset:")


@pytest.mark.asyncio
async def test_browse_returns_asset_list():
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
        response = await client.get("/browse?shot_id=sh010")
    assert response.status_code == 200
    body = response.json()
    assert "assets" in body
    assert isinstance(body["assets"], list)


@pytest.mark.asyncio
async def test_browse_without_filters_returns_assets():
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
        response = await client.get("/browse")
    assert response.status_code == 200
    assert "assets" in response.json()
