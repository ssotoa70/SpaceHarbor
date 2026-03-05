FROM python:3.12-slim

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
RUN pip install --no-cache-dir -e .

COPY src/ src/

ENV DEV_MODE=false
ENV KAFKA_BROKER=vastbroker:9092
ENV KAFKA_TOPIC=assetharbor.proxy

# Default OCIO config path — override via OCIO_CONFIG_PATH env var at runtime
ENV OCIO=/usr/share/color/opencolorio/aces_1.3/config.ocio
ENV OCIO_CONFIG_PATH=/usr/share/color/opencolorio/aces_1.3/config.ocio

# VAST DataEngine calls: python -m src.function
CMD ["python", "-m", "src.function"]
