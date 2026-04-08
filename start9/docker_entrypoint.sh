#!/bin/sh
set -e

printf "\n\n [i] Starting DeepSea Dashboard ...\n\n"

# Ensure Start9 data directories exist
mkdir -p /root/.config
mkdir -p /root/.data

# Copy default config if none exists
if [ ! -f /root/.config/config.json ]; then
  cp /root/.config/config.json.default /root/.config/config.json 2>/dev/null || true
fi

exec python3 -m uvicorn app.main:app --host 0.0.0.0 --port 8000 --workers 1
