# ⛏ DeepSea Dashboard

Real-time Bitcoin mining dashboard for [Ocean.xyz](https://ocean.xyz) pool miners. Track hashrate, earnings, workers, blocks, and profitability — all in a retro CRT terminal aesthetic.

![DeepSea Dashboard](https://img.shields.io/badge/v2.0.0-React%20%2B%20FastAPI-blue)

## Features

- **Live Hashrate Monitoring** — 60s, 10min, 3hr, 24hr with auto-scaling (TH/s → PH/s → EH/s)
- **Interactive Charts** — Chart.js hashrate history with theme-reactive colors, block annotations, Zustand persistence
- **Worker Management** — Per-worker cards with ASIC model detection, efficiency/power controls, earnings distribution
- **Block Explorer** — Real Bitcoin network blocks from mempool.space with pool donut chart and color-coded pool badges
- **Earnings & Payouts** — Payment history, daily/monthly summaries, estimated time to payout with progress bar
- **Notifications** — Block found, hashrate changes, worker online/offline, daily stats, payout alerts
- **3 Themes** — DeepSea (blue), Bitcoin (orange), Matrix (green) with CRT scanlines and phosphor glow
- **Audio Player** — Theme-aware playlists with crossfade transitions
- **PWA Support** — Service worker, offline caching, cross-tab sync
- **DATUM Gateway** — Connection status indicator for Ocean's DATUM protocol
- **Mobile First** — Hamburger nav, responsive grid, touch-optimized

## Architecture

```
frontend/          React 18 + TypeScript + Vite
├── src/
│   ├── components/   UI components (HashrateChart, AudioPlayer, etc.)
│   ├── hooks/        Custom hooks (useSSE, useMetrics, useWorkers, etc.)
│   ├── pages/        6 SPA routes (Dashboard, Workers, Blocks, Earnings, Notifications, Config)
│   ├── stores/       Zustand state management
│   ├── theme/        Global CSS + CRT aesthetic
│   └── utils/        Shared formatters

backend/           FastAPI + Pydantic + SQLite
├── app/
│   ├── routers/      API endpoints (metrics, workers, blocks, earnings, notifications, config)
│   ├── services/     Ocean API client, cache (Redis + fallback), worker service, notifications
│   ├── models.py     Pydantic models
│   ├── db.py         SQLite async (WAL mode)
│   └── config.py     Atomic config read/write
```

## Quick Start

```bash
# Clone and configure
git clone https://github.com/Djobleezy/DeepSea-Dashboard.git
cd DeepSea-Dashboard
cp config.json.example config.json  # Add your wallet address

# Run with Docker
docker compose up -d

# Access at http://localhost:5000
```

## Configuration

Edit `config.json`:

```json
{
  "wallet": "your-bitcoin-wallet-address",
  "power_cost": 0.12,
  "power_usage": 3000,
  "currency": "USD",
  "network_fee": 2.0,
  "theme": "deepsea",
  "extended_history": false
}
```

## Development

```bash
# Frontend
cd frontend && npm install && npm run dev

# Backend
cd backend && pip install -r requirements.txt
PYTHONPATH=backend uvicorn app.main:app --reload

# Tests
cd backend && pytest -q
cd frontend && npm test
```

## Docker

Multi-stage build: Node 22 (frontend) → Python 3.12 (backend). Redis for caching and pub/sub.

```bash
docker compose up -d --build
```

## API

| Endpoint | Description |
|---|---|
| `GET /api/metrics` | Current dashboard metrics |
| `GET /api/metrics/stream` | SSE live updates |
| `GET /api/workers` | Worker list with earnings |
| `GET /api/blocks` | Recent Bitcoin blocks |
| `GET /api/earnings` | Payment history |
| `GET /api/notifications` | Notification CRUD |
| `GET /api/health` | Service health check |
| `GET /api/config` | Dashboard configuration |

## Keyboard Shortcuts

| Key | Action |
|---|---|
| `Alt+1` | Dashboard |
| `Alt+2` | Workers |
| `Alt+3` | Blocks |
| `Alt+4` | Earnings |
| `Alt+5` | Notifications |
| `↑↑↓↓←→←→BA` | 🎮 |

## License

MIT — See [LICENSE.md](LICENSE.md)
