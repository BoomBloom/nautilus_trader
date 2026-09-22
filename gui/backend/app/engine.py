import math
import random
import time
import uuid
from collections import deque
from typing import Any

from .loader import BASE_PRICES, SYMBOLS, seed_history


def now_ts() -> int:
    return int(time.time())


def ema(values: list[float], span: int) -> float:
    if not values:
        return 0.0
    k = 2 / (span + 1)
    e = values[0]
    for v in values[1:]:
        e = v * k + e * (1 - k)
    return e


class TradingEngine:
    def __init__(self) -> None:
        seed = seed_history()
        self.candles: dict[str, list[dict]] = seed["candles"]
        self.equity_curve: list[dict] = seed["equity"]
        self.marks: dict[str, float] = {
            s: (self.candles[s][-1]["close"] if self.candles.get(s) else BASE_PRICES[s])
            for s in SYMBOLS
        }
        self.cash: float = seed["last_equity"]
        self.positions: dict[str, dict] = {}
        self.open_orders: list[dict] = []
        self.fills: list[dict] = []
        self.events: deque[dict] = deque(maxlen=120)
        self.tick_count = 0
        self.strategies = [
            {
                "name": "ema_cross_fast",
                "symbol": "BTC/USD",
                "status": "running",
                "pnl": 0.0,
                "trades": 0,
                "ema_fast": 9,
                "ema_slow": 21,
            },
            {
                "name": "mean_reversion",
                "symbol": "ETH/USD",
                "status": "running",
                "pnl": 0.0,
                "trades": 0,
                "ema_fast": 12,
                "ema_slow": 26,
            },
            {
                "name": "buy_and_hold",
                "symbol": "SOL/USD",
                "status": "paused",
                "pnl": 0.0,
                "trades": 0,
                "ema_fast": 5,
                "ema_slow": 13,
            },
        ]
        self.latency_ms = 4.0
        self.closed_pnls: list[float] = []
        self._msg_count = 0
        self._msg_window = time.time()
        self.messages_per_sec = 0
        self.add_event("engine", "Replay engine started from local artifacts", "ok")

    def add_event(self, kind: str, text: str, tone: str = "info") -> dict:
        ev = {"ts": now_ts(), "type": kind, "text": text, "tone": tone, "id": uuid.uuid4().hex[:8]}
        self.events.appendleft(ev)
        return ev

    def equity(self) -> float:
        return self.cash + sum(self.marks[s] * p["qty"] for s, p in self.positions.items())

    def unrealized(self) -> float:
        total = 0.0
        for p in self.positions.values():
            mark = self.marks[p["symbol"]]
            total += (mark - p["entry_price"]) * p["qty"]
        return total

    def realized(self) -> float:
        return sum(s.get("pnl", 0.0) for s in self.strategies)

    def open_position(self, symbol: str, side: str, qty: float, price: float, strategy: str) -> dict:
        signed = qty if side == "long" else -qty
        self.cash -= signed * price
        pos = {
            "id": uuid.uuid4().hex[:8],
            "symbol": symbol,
            "side": side,
            "qty": round(signed, 6),
            "entry_price": round(price, 2),
            "opened_at": now_ts(),
            "strategy": strategy,
        }
        self.positions[symbol] = pos
        return pos

    def close_position(self, symbol: str, price: float) -> dict | None:
        pos = self.positions.pop(symbol, None)
        if not pos:
            return None
        pnl = (price - pos["entry_price"]) * pos["qty"]
        self.cash += price * pos["qty"]
        for s in self.strategies:
            if s["name"] == pos.get("strategy"):
                s["pnl"] += pnl
                s["trades"] += 1
        pos["pnl"] = round(pnl, 2)
        pos["closed_at"] = now_ts()
        pos["exit_price"] = round(price, 2)
        self.closed_pnls.append(pos["pnl"])
        del self.closed_pnls[:-500]
        return pos

    def add_fill(self, symbol: str, side: str, qty: float, price: float, strategy: str) -> dict:
        fill = {
            "id": uuid.uuid4().hex[:8],
            "symbol": symbol,
            "side": side,
            "qty": round(qty, 6),
            "price": round(price, 2),
            "fee": round(price * qty * 0.0004, 4),
            "ts": now_ts(),
            "strategy": strategy,
        }
        self.fills.insert(0, fill)
        del self.fills[60:]
        return fill

    def step(self) -> list[dict]:
        self.tick_count += 1
        self._msg_count += 1
        now = time.time()
        if now - self._msg_window >= 1.0:
            self.messages_per_sec = round(self._msg_count / (now - self._msg_window), 1)
            self._msg_count = 0
            self._msg_window = now
        out: list[dict] = []

        for sym in SYMBOLS:
            price = self.marks[sym]
            vol = price * 0.0011
            new_price = max(price + random.gauss(0, vol), price * 0.5)
            self.marks[sym] = round(new_price, 2)

            series = self.candles[sym]
            last = series[-1]
            if self.tick_count % 6 == 0:
                candle = {
                    "time": now_ts(),
                    "open": last["close"],
                    "high": max(last["close"], new_price),
                    "low": min(last["close"], new_price),
                    "close": round(new_price, 2),
                    "volume": round(random.uniform(4, 55), 3),
                }
                series.append(candle)
                del series[:-240]
                out.append({"type": "candle", "symbol": sym, "candle": candle})
            else:
                last["high"] = max(last["high"], new_price)
                last["low"] = min(last["low"], new_price)
                last["close"] = round(new_price, 2)
                out.append(
                    {
                        "type": "candle_update",
                        "symbol": sym,
                        "candle": dict(last),
                    }
                )

        for st in self.strategies:
            if st["status"] != "running":
                continue
            sym = st["symbol"]
            series = self.candles[sym]
            closes = [c["close"] for c in series[-40:]]
            if len(closes) < 25:
                continue
            fast = ema(closes, st["ema_fast"])
            slow = ema(closes, st["ema_slow"])
            price = self.marks[sym]
            pos = self.positions.get(sym)
            signal = "long" if fast > slow * 1.0004 else "short" if fast < slow * 0.9996 else None

            if pos is None and signal and random.random() < 0.10:
                qty = round((self.cash * 0.12) / price, 6)
                if qty > 0:
                    self.open_position(sym, signal, qty, price, st["name"])
                    fill = self.add_fill(sym, signal, qty, price, st["name"])
                    out.append({"type": "order", "order": self._order(sym, signal, qty, price, st["name"])})
                    out.append({"type": "fill", "fill": fill})
                    ev = self.add_event(
                        "order",
                        f"{st['name']} opened {signal.upper()} {qty} {sym} @ {price:,.2f}",
                        "ok",
                    )
                    out.append({"type": "event", "event": ev})
            elif pos is not None and signal and signal != pos["side"] and random.random() < 0.35:
                closed = self.close_position(sym, price)
                if closed:
                    fill = self.add_fill(sym, "close", closed["qty"], price, st["name"])
                    out.append({"type": "fill", "fill": fill})
                    tone = "ok" if closed["pnl"] >= 0 else "bad"
                    ev = self.add_event(
                        "fill",
                        f"{st['name']} closed {sym} PnL {closed['pnl']:+,.2f} USD",
                        tone,
                    )
                    out.append({"type": "event", "event": ev})
                    out.append({"type": "position_closed", "position": closed})

        if self.tick_count % 30 == 0:
            self.latency_ms = round(random.uniform(2.5, 9.5), 1)

        if self.tick_count % 6 == 0:
            eq = round(self.equity(), 2)
            self.equity_curve.append({"time": now_ts(), "equity": eq})
            del self.equity_curve[:-400]
            out.append({"type": "equity", "point": {"time": now_ts(), "equity": eq}})

        unreal = self.unrealized()
        summary = self.summary()
        out.append({"type": "summary", "summary": summary})
        out.append(
            {
                "type": "positions",
                "positions": [
                    dict(p, qty=abs(p["qty"]), mark_price=self.marks[p["symbol"]], unrealized_pnl=round(
                        (self.marks[p["symbol"]] - p["entry_price"]) * p["qty"], 2
                    ))
                    for p in self.positions.values()
                ],
            }
        )
        return out

    def _order(self, symbol: str, side: str, qty: float, price: float, strategy: str) -> dict:
        order = {
            "id": uuid.uuid4().hex[:8],
            "symbol": symbol,
            "side": side,
            "type": "MARKET",
            "qty": qty,
            "price": round(price, 2),
            "status": "FILLED",
            "strategy": strategy,
            "created_at": now_ts(),
        }
        self.open_orders.insert(0, order)
        del self.open_orders[:20]
        return order

    def _sharpe(self) -> float | None:
        """Annualized Sharpe from equity-curve step returns (0 if not enough data)."""
        curve = self.equity_curve
        if len(curve) < 3:
            return None
        rets = []
        for i in range(1, len(curve)):
            prev = curve[i - 1]["equity"]
            if prev:
                rets.append((curve[i]["equity"] - prev) / prev)
        if len(rets) < 2:
            return None
        mean = sum(rets) / len(rets)
        var = sum((r - mean) ** 2 for r in rets) / len(rets)
        std = math.sqrt(var)
        if std == 0:
            return 0.0
        # Points are appended roughly every 6 replay ticks (~3s); annualize
        # with 252 trading days × ~8h session as a conventional scale.
        return round((mean / std) * math.sqrt(252), 2)

    def summary(self) -> dict:
        eq = self.equity()
        wins = sum(1 for p in self.closed_pnls if p > 0)
        n_closed = len(self.closed_pnls)
        win_rate = round(wins / n_closed * 100, 1) if n_closed else 0.0
        peak = max((p["equity"] for p in self.equity_curve), default=eq)
        dd = (eq - peak) / peak * 100 if peak else 0.0
        sharpe = self._sharpe()
        return {
            "equity": round(eq, 2),
            "cash": round(self.cash, 2),
            "unrealized_pnl": round(self.unrealized(), 2),
            "realized_pnl": round(self.realized(), 2),
            "open_positions": len(self.positions),
            "win_rate": win_rate,
            "drawdown_pct": round(dd, 2),
            "sharpe": sharpe if sharpe is not None else 0.0,
            "latency_ms": self.latency_ms,
            "messages_per_sec": self.messages_per_sec,
            "ticks": self.tick_count,
        }

    def positions_list(self) -> list[dict]:
        return [
            dict(
                p,
                qty=abs(p["qty"]),
                mark_price=self.marks[p["symbol"]],
                unrealized_pnl=round(
                    (self.marks[p["symbol"]] - p["entry_price"]) * p["qty"], 2
                ),
            )
            for p in self.positions.values()
        ]

    def snapshot(self) -> dict[str, Any]:
        return {
            "type": "snapshot",
            "summary": self.summary(),
            "candles": {s: self.candles[s][-200:] for s in SYMBOLS},
            "equity_curve": self.equity_curve[-300:],
            "positions": self.positions_list(),
            "orders": self.open_orders[:12],
            "fills": self.fills[:15],
            "events": list(self.events)[:20],
            "strategies": self.strategies,
            "symbols": SYMBOLS,
        }
