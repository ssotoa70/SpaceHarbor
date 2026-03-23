FROM python:3.12-slim@sha256:ccc7089399c8bb65dd1fb3ed6d55efa538a3f5e7fca3f5988ac3b5b87e593bf0

RUN apt-get update && apt-get install -y --no-install-recommends \
    openimageio-tools \
    libimage-exiftool-perl \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY shared/ ./shared/
COPY src/ ./src/

# Create non-root user
RUN groupadd -r app && useradd -r -g app app \
    && chown -R app:app /app

USER app

ENTRYPOINT ["python", "-m", "src.function"]
