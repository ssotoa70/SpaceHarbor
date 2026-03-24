import os
import uuid
from fastapi import APIRouter, HTTPException, Query
from pydantic import BaseModel
from src.resolver import VastResolver, AssetNotFoundError

router = APIRouter()

_dev_mode = os.getenv("DEV_MODE", "false").lower() == "true"

if not _dev_mode and not os.getenv("SPACEHARBOR_CONTROL_PLANE_URL"):
    raise ValueError(
        "DEV_MODE is not enabled and SPACEHARBOR_CONTROL_PLANE_URL is not set. "
        "Set DEV_MODE=true for local development or provide SPACEHARBOR_CONTROL_PLANE_URL "
        "for production mode."
    )

_resolver = VastResolver(
    trino_host=os.getenv("VAST_DB_HOST", os.getenv("TRINO_HOST", "localhost")),
    trino_port=int(os.getenv("VAST_DB_PORT", os.getenv("TRINO_PORT", "8080"))),
    dev_mode=_dev_mode,
)


# --- /resolve ---

class ResolveRequest(BaseModel):
    entity_ref: str


class ResolveResponse(BaseModel):
    entity_ref: str
    uri: str


@router.post("/resolve", response_model=ResolveResponse)
async def resolve(body: ResolveRequest) -> ResolveResponse:
    try:
        uri = _resolver.resolve(body.entity_ref)
        return ResolveResponse(entity_ref=body.entity_ref, uri=uri)
    except AssetNotFoundError as e:
        raise HTTPException(status_code=404, detail=str(e))


# --- /register ---

class RegisterRequest(BaseModel):
    name: str
    shot_id: str
    source_uri: str
    version_label: str


class RegisterResponse(BaseModel):
    entity_ref: str
    asset_id: str


@router.post("/register", response_model=RegisterResponse, status_code=201)
async def register(body: RegisterRequest) -> RegisterResponse:
    asset_id = str(uuid.uuid4())
    if not os.getenv("DEV_MODE", "true").lower() == "true":
        import requests as req
        cp_url = os.getenv("CONTROL_PLANE_URL", "http://control-plane:3000")
        resp = req.post(f"{cp_url}/api/v1/ingest", json={
            "asset_id": asset_id,
            "name": body.name,
            "shot_id": body.shot_id,
            "source_uri": body.source_uri,
            "version_label": body.version_label,
        }, timeout=10)
        resp.raise_for_status()
    return RegisterResponse(entity_ref=f"asset:{asset_id}", asset_id=asset_id)


# --- /browse ---

class BrowseResponse(BaseModel):
    assets: list[dict]


@router.get("/browse", response_model=BrowseResponse)
async def browse(
    shot_id: str | None = Query(default=None),
    project_id: str | None = Query(default=None),
) -> BrowseResponse:
    assets = _resolver.list_assets(shot_id=shot_id, project_id=project_id)
    return BrowseResponse(assets=assets)
