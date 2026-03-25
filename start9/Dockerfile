# syntax=docker/dockerfile:1.7

# ---- Stage 1: Build frontend ----
FROM node:22-alpine AS frontend-builder
WORKDIR /app/frontend

COPY frontend/package.json frontend/package-lock.json ./
RUN --mount=type=cache,target=/root/.npm npm ci

COPY frontend/ ./
RUN npm run build

# ---- Stage 2: Runtime image ----
FROM python:3.12-slim AS runtime

# Start9 convention: data in /root/.data, config in /root/.config
ENV PYTHONUNBUFFERED=1 \
    PYTHONPATH=/app/backend \
    DB_PATH=/root/.data/deepsea.db \
    CONFIG_PATH=/root/.config/config.json

RUN apt-get update && apt-get install -y --no-install-recommends \
    libxml2 \
    libxslt1.1 \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Python deps first for better layer caching
COPY backend/requirements.txt ./
RUN --mount=type=cache,target=/root/.cache/pip \
    pip install --no-cache-dir -r requirements.txt

# Copy backend and built frontend assets
COPY backend/ ./backend/
COPY --from=frontend-builder /app/frontend/dist ./frontend/dist

# Copy example config as fallback
COPY config.json.example /root/.config/config.json

# Start9 entrypoint
ADD start9/docker_entrypoint.sh /usr/local/bin/docker_entrypoint.sh
RUN chmod a+x /usr/local/bin/docker_entrypoint.sh

EXPOSE 8000
