FROM python:3.12-slim@sha256:ccc7089399c8bb65dd1fb3ed6d55efa538a3f5e7fca3f5988ac3b5b87e593bf0

# Install FFmpeg (Debian build is LGPL) + OpenH264 and SVT-AV1 libraries
RUN apt-get update && apt-get install -y --no-install-recommends \
    ffmpeg \
    libopenh264-7 \
    libsvtav1enc1 \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY ffmpeg-transcoder/pyproject.toml .
RUN pip install --no-cache-dir .

# Shared CloudEvent publisher (referenced via sys.path)
# Build context must be set to dataengine-functions/ (parent dir)
COPY shared/ /app/shared/

COPY ffmpeg-transcoder/src/ src/
COPY ffmpeg-transcoder/profiles/ profiles/

# Create non-root user
RUN groupadd -r app && useradd -r -g app app \
    && chown -R app:app /app

USER app

ARG DEV_MODE=false
ENV DEV_MODE=${DEV_MODE}
ENV KAFKA_BROKER=vastbroker:9092
ENV TRANSCODE_PROFILE=h264_review

# VAST DataEngine calls: python -m src.function
CMD ["python", "-m", "src.function"]
