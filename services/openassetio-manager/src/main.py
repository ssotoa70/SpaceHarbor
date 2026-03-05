from fastapi import FastAPI

app = FastAPI(title="AssetHarbor OpenAssetIO Manager", version="0.1.0")


@app.get("/health")
async def health() -> dict:
    return {"status": "ok", "service": "openassetio-manager"}
