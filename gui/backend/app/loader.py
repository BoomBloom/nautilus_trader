import csv
import random
import time
from pathlib import Path

DATA_DIR = Path(__file__).resolve().parents[1] / "data"

SYMBOLS = ["BTC/USD", "ETH/USD", "SOL/USD"]

BASE_PRICES = {"BTC/USD": 68000.0, "ETH/USD": 3400.0, "SOL/USD": 155.0}


def load_equity_history() -> list[dict]:
    path = DATA_DIR / "equity.csv"
    if not path.exists():
        return []
    rows: list[dict] = []
    with path.open(newline="") as f:
        for r in csv.DictReader(f):
            rows.append({"time": int(float(r["time"])), "equity": float(r["equity"])})
    return rows


def load_candles(symbol: str) -> list[dict]:
    safe = symbol.replace("/", "_")
    path = DATA_DIR / f"candles_{safe}.csv"
    if not path.exists():
        return []
    rows: list[dict] = []
    with path.open(newline="") as f:
        for r in csv.DictReader(f):
            rows.append(
                {
                    "time": int(float(r["time"])),
                    "open": float(r["open"]),
                    "high": float(r["high"]),
                    "low": float(r["low"]),
                    "close": float(r["close"]),
                    "volume": float(r["volume"]),
                }
            )
    return rows


def seed_history(n_candles: int = 180, n_equity: int = 180) -> dict:
    now = int(time.time())
    candles: dict[str, list[dict]] = {}
    for sym in SYMBOLS:
        rows = load_candles(sym)
        if rows:
            candles[sym] = rows[-n_candles:]
        else:
            price = BASE_PRICES[sym]
            out = []
            t = now - n_candles * 60
            for _ in range(n_candles):
                drift = price * 0.0012
                o = price
                c = price + random.gauss(0, drift)
                hi = max(o, c) * (1 + abs(random.gauss(0, 0.0006)))
                lo = min(o, c) * (1 - abs(random.gauss(0, 0.0006)))
                out.append(
                    {
                        "time": t,
                        "open": round(o, 2),
                        "high": round(hi, 2),
                        "low": round(lo, 2),
                        "close": round(c, 2),
                        "volume": round(random.uniform(5, 60), 3),
                    }
                )
                price = c
                t += 60
            candles[sym] = out

    equity_rows = load_equity_history()
    if equity_rows:
        equity = equity_rows[-n_equity:]
    else:
        base = 100000.0
        eq = base
        out = []
        t = now - n_equity * 60
        for _ in range(n_equity):
            eq += random.gauss(30, 180)
            out.append({"time": t, "equity": round(eq, 2)})
            t += 60
        equity = out

    return {"candles": candles, "equity": equity, "last_equity": equity[-1]["equity"]}
