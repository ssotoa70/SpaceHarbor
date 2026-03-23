FROM python:3.11-slim@sha256:d6e4d224f70f9e0172a06a3a2eba2f768eb146811a349278b38fff3a36463b47

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
