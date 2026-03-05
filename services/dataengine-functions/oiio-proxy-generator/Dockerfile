FROM python:3.12-slim

# Install system dependencies: oiiotool, ffmpeg
RUN apt-get update && apt-get install -y --no-install-recommends \
    openimageio-tools \
    python3-openimageio \
    python3-pyopencolorio \
    ffmpeg \
    ocio-configs \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY pyproject.toml .
RUN pip install --no-cache-dir -e .

COPY src/ src/

ENV DEV_MODE=false
ENV KAFKA_BROKER=vastbroker:9092
ENV KAFKA_TOPIC=assetharbor.proxy

# VAST DataEngine calls: python -m src.function
CMD ["python", "-m", "src.function"]
