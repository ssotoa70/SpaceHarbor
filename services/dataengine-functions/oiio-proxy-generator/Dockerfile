FROM python:3.12-slim@sha256:ccc7089399c8bb65dd1fb3ed6d55efa538a3f5e7fca3f5988ac3b5b87e593bf0

# Install system dependencies: oiiotool, ffmpeg
# Note: python3-pyopencolorio and ocio-configs are not in Debian stable.
# oiio-proxy-generator uses oiiotool --colorconvert (reads OCIO env var),
# not the Python PyOpenColorIO bindings directly.
RUN apt-get update && apt-get install -y --no-install-recommends \
    openimageio-tools \
    python3-openimageio \
    ffmpeg \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY pyproject.toml .
RUN pip install --no-cache-dir .

COPY src/ src/

# Create non-root user
RUN groupadd -r app && useradd -r -g app app \
    && chown -R app:app /app

USER app

ARG DEV_MODE=false
ENV DEV_MODE=${DEV_MODE}
ENV KAFKA_BROKER=vastbroker:9092
ENV KAFKA_TOPIC=spaceharbor.proxy

# Default OCIO config path — override via OCIO_CONFIG_PATH env var at runtime
ENV OCIO=/usr/share/color/opencolorio/aces_1.3/config.ocio
ENV OCIO_CONFIG_PATH=/usr/share/color/opencolorio/aces_1.3/config.ocio

# VAST DataEngine calls: python -m src.function
CMD ["python", "-m", "src.function"]
