# ---- Stage 1: Build frontend ----
FROM node:22-alpine AS frontend-builder
WORKDIR /app/frontend
COPY frontend/package.json frontend/package-lock.json* ./
RUN npm ci --prefer-offline 2>/dev/null || npm install
COPY frontend/ .
RUN npm run build

# ---- Stage 2: Final image ----
FROM python:3.12-slim

RUN apt-get update && apt-get install -y --no-install-recommends \
    curl libxml2 libxslt1.1 \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Python deps
COPY backend/requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

# Copy backend
COPY backend/ ./backend/

# Copy built frontend
COPY --from=frontend-builder /app/frontend/dist ./frontend/dist

# Keep root for local dev deployment so the mounted SQLite volume stays writable
EXPOSE 8000

ENV PYTHONUNBUFFERED=1
ENV PYTHONPATH=/app/backend
ENV DB_PATH=/data/deepsea.db

HEALTHCHECK --interval=30s --timeout=10s --start-period=15s --retries=3 \
  CMD curl -f http://localhost:8000/api/health || exit 1

CMD ["python", "-m", "uvicorn", "app.main:app", \
     "--host", "0.0.0.0", "--port", "8000", "--workers", "1"]
