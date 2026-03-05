from fastapi import FastAPI
from src.routes.manager import router as manager_router

app = FastAPI(title="AssetHarbor OpenAssetIO Manager", version="0.1.0")
app.include_router(manager_router)


@app.get("/health")
async def health() -> dict:
    return {"status": "ok", "service": "openassetio-manager"}
