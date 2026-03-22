# ⛏ DeepSea Dashboard

Real-time Bitcoin mining dashboard for [Ocean.xyz](https://ocean.xyz) pool miners. Track hashrate, earnings, workers, and blocks — all in a retro CRT terminal aesthetic.

[![CI](https://github.com/Djobleezy/DeepSea-Dashboard/actions/workflows/ci.yml/badge.svg)](https://github.com/Djobleezy/DeepSea-Dashboard/actions/workflows/ci.yml)
![Version](https://img.shields.io/badge/v2.0.4-React%20%2B%20FastAPI-blue)
![License](https://img.shields.io/badge/license-MIT-green)

---

## Table of Contents

- [Features](#features)
- [Architecture](#architecture)
- [Quick Start](#quick-start)
- [Configuration Reference](#configuration-reference)
- [Development Setup](#development-setup)
- [API Reference](#api-reference)
- [Keyboard Shortcuts](#keyboard-shortcuts)
- [Screenshots](#screenshots)
- [Troubleshooting](#troubleshooting)

---

## Features

- **Live Hashrate Monitoring** — 60s, 10min, 3hr, 24hr with auto-scaling (TH/s → PH/s → EH/s)
- **Interactive Charts** — Chart.js hashrate history with theme-reactive colors, block annotations, Zustand persistence
- **Worker Management** — Per-worker cards with ASIC model detection, efficiency/power controls, proportional earnings distribution
- **Block Explorer** — Real Bitcoin network blocks from mempool.space with pool donut chart and color-coded pool badges
- **Earnings & Payouts** — Payment history, daily/monthly summaries, estimated time to payout with progress bar
- **Notifications** — Block found, hashrate changes, worker online/offline, daily stats, payout alerts
- **3 Themes** — DeepSea (blue), Bitcoin (orange), Matrix (green) with CRT scanlines and phosphor glow
- **Audio Player** — Theme-aware playlists with crossfade transitions
- **PWA Support** — Service worker, offline caching, cross-tab sync via BroadcastChannel
- **DATUM Gateway** — Connection status indicator for Ocean's DATUM protocol
- **Batch API** — Dashboard loads metrics + workers + blocks in a single HTTP call
- **Mobile First** — Hamburger nav, responsive grid, touch-optimized

---

## Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│                        Browser / PWA                            │
│                                                                 │
│   React 18 + TypeScript + Vite                                  │
│   ┌──────────┐  ┌─────────┐  ┌────────┐  ┌──────────────────┐  │
│   │Dashboard │  │Workers  │  │Blocks  │  │ Earnings / Notif │  │
│   └────┬─────┘  └────┬────┘  └───┬────┘  └────────┬─────────┘  │
│        └─────────────┴───────────┴────────────────┘            │
│                       API Client (client.ts)                    │
│                  batchFetch() + individual calls                │
└──────────────────────────────┬──────────────────────────────────┘
                               │ HTTP / SSE
┌──────────────────────────────▼──────────────────────────────────┐
│                    FastAPI Backend (Python 3.12)                 │
│                                                                 │
│  /api/metrics  /api/workers  /api/blocks  /api/earnings         │
│  /api/notifications  /api/config  /api/batch  /api/health       │
│  /api/stream (SSE)                                              │
│                                                                 │
│  ┌──────────────┐  ┌───────────────┐  ┌────────────────────┐   │
│  │  Background  │  │  Ocean Client │  │  Notification Eng. │   │
│  │  Loop (30s)  │  │  (httpx)      │  │  (SQLite WAL)      │   │
│  └──────┬───────┘  └───────┬───────┘  └────────────────────┘   │
└─────────┼───────────────────┼─────────────────────────────────-─┘
          │                   │ HTTPS
┌─────────▼──────┐  ┌─────────▼────────┐  ┌───────────────────┐
│   Redis Cache  │  │   Ocean.xyz API  │  │  mempool.space    │
│   (pub/sub +   │  │   (mining data)  │  │  (block data)     │
│    fallback)   │  └──────────────────┘  └───────────────────┘
└────────────────┘
         │
┌────────▼───────┐
│  SQLite (WAL)  │
│  metric_history│
│  notifications │
└────────────────┘
```

**Data flow:**
1. Background loop fetches Ocean.xyz API every 30s → stores in Redis + SQLite
2. SSE stream pushes live updates to all connected browsers
3. Browser API client uses `batchFetch()` on load (metrics + workers + blocks in 1 HTTP call)
4. Zustand store holds UI state; BroadcastChannel syncs across tabs

---

## Quick Start

### Docker (recommended)

```bash
# 1. Clone the repo
git clone https://github.com/Djobleezy/DeepSea-Dashboard.git
cd DeepSea-Dashboard

# 2. Create your config
cp config.json.example config.json
# Edit config.json with your wallet address (see Configuration Reference below)

# 3. Start everything
docker compose up -d

# 4. Open the dashboard
open http://localhost:5000
```

The Docker setup starts:
- `app` — FastAPI backend serving the frontend static files on port 5000
- `redis` — Redis 7 for caching and pub/sub

### Stop / Restart

```bash
docker compose down          # stop containers
docker compose restart app   # restart only the backend
docker compose logs -f app   # tail logs
```

---

## Configuration Reference

All configuration lives in `config.json` at the repo root. Changes are applied via the dashboard Config page or by editing the file directly (backend auto-reloads).

```json
{
  "wallet": "your-bitcoin-wallet-address",
  "power_cost": 0.12,
  "power_usage": 3450,
  "currency": "USD",
  "timezone": "America/Los_Angeles",
  "network_fee": 0.5,
  "theme": "deepsea",
  "extended_history": false
}
```

| Field | Type | Default | Description |
|-------|------|---------|-------------|
| `wallet` | `string` | `""` | **Required.** Your Ocean.xyz wallet/payout address |
| `power_cost` | `float` | `0.12` | Electricity cost in USD per kWh (0.01–1.00) |
| `power_usage` | `float` | `3450` | Total rig power draw in watts (1–50,000) |
| `currency` | `string` | `"USD"` | Display currency: `USD`, `EUR`, `GBP`, `CAD`, `AUD`, `JPY` |
| `timezone` | `string` | `"America/Los_Angeles"` | IANA timezone for time display (see `/api/timezones`) |
| `network_fee` | `float` | `0.5` | Mining pool fee percentage for profit calculation (0–10) |
| `theme` | `string` | `"deepsea"` | UI theme: `deepsea`, `bitcoin`, or `matrix` |
| `extended_history` | `bool` | `false` | Keep up to 7 days of metric history instead of 24h |

> **Note:** A missing or empty `wallet` will cause all Ocean.xyz API calls to fail gracefully — the dashboard loads but shows zero values.

---

## Development Setup

### Prerequisites

- Node.js 22+
- Python 3.12+
- Redis (optional — backend falls back to in-process cache)

### Frontend

```bash
cd frontend
npm install
npm run dev        # dev server at http://localhost:5173 (proxies /api to :8000)
npm run build      # production build → frontend/dist/
npm test           # run Vitest test suite
npm run lint       # ESLint check
```

### Backend

```bash
cd backend
pip install -r requirements.txt

# Start with auto-reload
PYTHONPATH=backend uvicorn app.main:app --reload --port 8000

# Run tests
PYTHONPATH=backend pytest -q

# Lint
ruff check .
```

### Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `REDIS_URL` | `redis://redis:6379` | Redis connection URL |
| `RATE_LIMIT_PER_MIN` | `120` | Max API requests per IP per minute |
| `CORS_ORIGINS` | `*` | Comma-separated allowed CORS origins |
| `VITE_API_BASE` | `/api` | Frontend: API base path |
| `VITE_API_TIMEOUT_MS` | `10000` | Frontend: API request timeout (ms) |

---

## API Reference

Base URL: `http://localhost:5000/api`

Interactive docs: [`/docs`](http://localhost:5000/docs) (Swagger UI) · [`/redoc`](http://localhost:5000/redoc)

### Metrics

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/api/metrics` | Current mining snapshot (hashrates, earnings, BTC price, pool stats) |
| `GET` | `/api/metrics/history` | Historical metric snapshots for chart hydration. Query: `hours` (1–168) |
| `GET` | `/api/stream` | SSE stream — real-time push of `metrics` and `workers` events |

### Workers

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/api/workers` | Worker fleet with per-worker hashrate, status, efficiency, earnings. Query: `status` (all/online/offline), `sort_by`, `descending` |

### Blocks

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/api/blocks` | Recent Bitcoin network blocks from mempool.space. Query: `page`, `page_size` |

### Earnings

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/api/earnings` | Payment history and daily/monthly aggregates. Query: `days` (1–365) |

### Notifications

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/api/notifications` | List notifications. Query: `category`, `unread_only`, `limit` |
| `POST` | `/api/notifications` | Create notification |
| `PATCH` | `/api/notifications/{id}/read` | Mark notification as read |
| `POST` | `/api/notifications/read-all` | Mark all notifications as read |
| `DELETE` | `/api/notifications/{id}` | Delete notification |
| `DELETE` | `/api/notifications/clear/read` | Delete all read notifications |
| `DELETE` | `/api/notifications/clear/all` | Delete all notifications |

### Config

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/api/config` | Get current dashboard configuration |
| `POST` | `/api/config` | Update configuration (triggers metrics refresh) |
| `GET` | `/api/timezones` | List all valid IANA timezone strings |

### System

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/api/health` | Health check — version, Redis status, wallet status, uptime |
| `POST` | `/api/batch` | Batch up to 10 GET requests in a single HTTP call. Body: `{ requests: [{ method, path }] }`. Returns `{ responses: [{ status, body }], executed, duration_ms }` |

### SSE Event Types

The `/api/stream` endpoint emits these server-sent events:

| Event | Payload | Description |
|-------|---------|-------------|
| `metrics` | `DashboardMetrics` JSON | Full metrics snapshot |
| `workers` | `WorkerSummary` JSON | Worker fleet update |
| `heartbeat` | `{ ts: number }` | Keep-alive (every 30s idle) |

---

## Keyboard Shortcuts

| Key | Action |
|-----|--------|
| `Alt+1` | Navigate to Dashboard |
| `Alt+2` | Navigate to Workers |
| `Alt+3` | Navigate to Blocks |
| `Alt+4` | Navigate to Earnings |
| `Alt+5` | Navigate to Notifications |
| `Alt+6` | Navigate to Config |
| `Alt+T` | Cycle theme (DeepSea → Bitcoin → Matrix) |
| `Alt+M` | Toggle audio mute |
| `↑↑↓↓←→←→BA` | 🎮 Easter egg |

---

## Screenshots

> Screenshots coming soon — contributions welcome!

| View | Preview |
|------|---------|
| Dashboard | _(placeholder)_ |
| Workers | _(placeholder)_ |
| Blocks | _(placeholder)_ |
| Earnings | _(placeholder)_ |
| Boot Sequence | _(placeholder)_ |

---

## Troubleshooting

### Dashboard shows all zeros / "N/A"

- **Wallet not configured** — edit `config.json` and set `wallet` to your Ocean.xyz payout address
- **Ocean.xyz API unreachable** — check your network; the backend logs will show HTTP errors
- Check `docker compose logs app` for error details

### Redis connection errors

```
Redis not connected — falling back to in-process cache
```

This is a warning, not an error. The dashboard works without Redis using an in-process dict cache. Redis is only needed for multi-instance deployments or SSE pub/sub across workers.

To fix: ensure `REDIS_URL` is set correctly and Redis is running:
```bash
docker compose up -d redis
```

### SSE stream disconnects frequently

- Cloudflare / nginx proxies may have 60–90s timeout limits — add `proxy_read_timeout 3600;` to nginx config
- The SSE client reconnects automatically with exponential backoff (max 30s)

### Frontend dev server can't reach API

- Ensure backend is running on port 8000: `PYTHONPATH=backend uvicorn app.main:app --reload`
- Vite proxies `/api` → `http://localhost:8000` (configured in `vite.config.ts`)

### Docker container won't start

```bash
docker compose logs app     # check for Python errors
docker compose logs redis   # check Redis
```

Common issues:
- `config.json` missing — copy from `config.json.example`
- Port 5000 already in use — change `ports` in `docker-compose.yml`

### Tests failing

```bash
# Backend
cd backend && PYTHONPATH=backend pytest -v

# Frontend
cd frontend && npm test -- --reporter=verbose
```

---

## License

MIT — See [LICENSE.md](LICENSE.md)
