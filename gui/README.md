# Nautilus GUI

Full GUI for the local [NautilusTrader](https://github.com/BoomBloom/nautilus_trader) fork:
live monitoring dashboard **plus** an embedded `BacktestEngine` runner.

- **Frontend:** Next.js 14 (App Router) + TypeScript + Tailwind CSS + lightweight-charts
- **Backend:** FastAPI + WebSocket stream + embedded NautilusTrader backtest bridge
- **Data:** local backtest artifacts (CSV in `backend/data/`) with a built-in market simulator fallback

## Features

- **Monitor** — live replay stream: candles, equity, positions, fills, event feed
- **Backtest** — run the nautilus `BacktestEngine` with the GUI bridge strategy
  (EMA-cross over synthetic AUD/USD 1-min bars on a SIM venue), results stream into
  the dashboard over the same WebSocket message shapes
- **Markets / Positions / Orders / Strategies / Events** — dedicated views over the stream
- **Integrations / Settings** — connection and session configuration

## Backend setup (Python 3.13 + nautilus wheel)

```bash
cd backend
python3.13 -m venv .venv
.venv/bin/pip install uv
.venv/bin/uv pip install \
  -i https://packages.nautechsystems.io/simple \
  --extra-index-url https://pypi.org/simple \
  --index-strategy unsafe-best-match --pre \
  "nautilus-trader==2.0.0rc6.dev20260921"
.venv/bin/uv pip install "fastapi" "uvicorn[standard]" "pandas"
.venv/bin/uvicorn app.main:app --host 127.0.0.1 --port 8000
```

## Frontend

```bash
cd frontend
npm install
npm run build
npm run start -- -p 3000
```

Open http://localhost:3000

## Backtest API

- `POST /api/backtest/run` — body: `{"n_bars":600,"fast_ema_period":10,"slow_ema_period":20,"starting_balance":100000,"seed":7}`
- `GET  /api/backtest/status` — `{running, last_result}`

Runs off-thread (`asyncio.to_thread`); 409 if a run is already active. Engine events
(`summary`, `fill`, `order`, `positions`, `candle`, `event`) broadcast to all WebSocket
clients while the replay simulator pauses.

## Feed it your own backtest data

Put CSVs in `backend/data/`:

- `candles_BTC_USD.csv` → `time,open,high,low,close,volume` (unix seconds)
- `equity.csv` → `time,equity`

## Swap replay → live nautilus message bus (next step)

The backend exposes a single broadcast seam (`app/main.py`). To go live, add a
custom actor inside your Nautilus node that subscribes to events and forwards
JSON over the same WebSocket message shapes (`summary`, `fill`, `positions`, …).
No frontend changes required. See `GuiBridgeStrategy` in `backend/app/bridge.py`
for the streaming pattern.
