import os
from fastapi import APIRouter, HTTPException
from pydantic import BaseModel
from src.resolver import VastResolver, AssetNotFoundError

router = APIRouter()

_resolver = VastResolver(
    trino_host=os.getenv("TRINO_HOST", "localhost"),
    trino_port=int(os.getenv("TRINO_PORT", "8080")),
    dev_mode=os.getenv("DEV_MODE", "true").lower() == "true",
)


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
