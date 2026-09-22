"""Convert Nautilus domain objects into JSON-safe dictionaries for the GUI."""

from __future__ import annotations

import time
import uuid
from typing import Any


def num(x: Any) -> float:
    if x is None:
        return 0.0
    if hasattr(x, "as_f64"):
        try:
            return float(x.as_f64())
        except Exception:
            pass
    try:
        return float(x)
    except Exception:
        pass
    try:
        return float(str(x))
    except Exception:
        return 0.0


def symbol(instrument_id: Any) -> str:
    return str(instrument_id).split(".")[0]


def now_ts() -> int:
    return int(time.time())


def feed_event(kind: str, text: str, tone: str = "info") -> dict:
    return {
        "type": "event",
        "event": {
            "id": uuid.uuid4().hex[:8],
            "ts": now_ts(),
            "type": kind,
            "text": text,
            "tone": tone,
        },
    }


def order_to_dict(order: Any) -> dict:
    side = str(getattr(order, "side", ""))
    side_l = "buy" if "BUY" in side.upper() else "sell"
    status = str(getattr(order, "status", "")).upper()
    for prefix in ("ORDERSTATE.", "ORDERSTATE_"):
        if status.startswith(prefix):
            status = status[len(prefix) :]
    order_type = str(getattr(order, "order_type", "UNKNOWN"))
    for prefix in ("ORDERTYPE.", "ORDERTYPE_"):
        if order_type.startswith(prefix):
            order_type = order_type[len(prefix) :]
    tif = str(getattr(order, "time_in_force", ""))
    for prefix in ("TIMEINFORCE.", "TIMEINFORCE_"):
        if tif.startswith(prefix):
            tif = tif[len(prefix) :]
    tif = tif.upper()
    expires = getattr(order, "expire_time", None)
    created = getattr(order, "ts_init", 0) or 0
    return {
        "fee": 0.0,
        "tif": tif,
        "expires_at": int(expires // 1_000_000_000) if expires and expires > 1e12 else None,
        "id": str(getattr(order, "client_order_id", "")),
        "venue_order_id": str(getattr(order, "venue_order_id", "") or ""),
        "symbol": symbol(getattr(order, "instrument_id", "")),
        "instrument_id": str(getattr(order, "instrument_id", "")),
        "side": side_l,
        "type": order_type,
        "qty": round(num(getattr(order, "quantity", 0)), 8),
        "price": round(num(getattr(order, "price", 0)) or 0.0, 8),
        "filled_qty": round(num(getattr(order, "filled_qty", 0)), 8),
        "avg_px": round(num(getattr(order, "avg_px", 0)) or 0.0, 8),
        "status": status,
        "strategy": str(getattr(order, "strategy_id", "") or ""),
        "created_at": int(created // 1_000_000_000) if created > 1e12 else now_ts(),
    }


def position_to_dict(p: Any) -> dict:
    side = str(getattr(p, "side", "")).lower()
    if side.endswith("long"):
        side_l = "long"
    elif side.endswith("short"):
        side_l = "short"
    else:
        side_l = side or "long"
    opened = getattr(p, "ts_opened", 0) or getattr(p, "ts_init", 0) or 0
    return {
        "id": str(getattr(p, "position_id", "")),
        "symbol": symbol(getattr(p, "instrument_id", "")),
        "instrument_id": str(getattr(p, "instrument_id", "")),
        "side": side_l,
        "qty": abs(round(num(getattr(p, "quantity", 0)), 8)),
        "entry_price": round(num(getattr(p, "avg_px_open", 0)), 8),
        "mark_price": round(num(getattr(p, "last_px", 0)), 8),
        "realized_pnl": round(num(getattr(p, "realized_pnl", 0)), 4),
        "unrealized_pnl": round(num(getattr(p, "unrealized_pnl", 0)) if getattr(p, "unrealized_pnl", None) is not None else 0.0, 4),
        "opened_at": int(opened // 1_000_000_000) if opened > 1e12 else now_ts(),
        "strategy": str(getattr(p, "strategy_id", "") or ""),
    }


def fill_from_event(event: Any, strategy: str = "") -> dict:
    side = str(getattr(event, "order_side", ""))
    side_l = "buy" if "BUY" in side.upper() else "sell"
    ts = getattr(event, "ts_event", 0) or 0
    return {
        "id": str(getattr(event, "trade_id", "")),
        "symbol": symbol(getattr(event, "instrument_id", "")),
        "side": side_l,
        "qty": round(num(getattr(event, "last_qty", 0)), 8),
        "price": round(num(getattr(event, "last_px", 0)), 8),
        "fee": round(num(getattr(event, "commission", 0)), 6),
        "ts": int(ts // 1_000_000_000) if ts > 1e12 else now_ts(),
        "strategy": strategy,
    }


def instrument_to_dict(inst: Any) -> dict:
    return {
        "id": str(getattr(inst, "id", inst)),
        "symbol": symbol(getattr(inst, "id", inst)),
        "venue": str(getattr(inst, "venue", "")),
        "kind": type(inst).__name__,
        "base": str(getattr(getattr(inst, "base_currency", None) or "", "") or ""),
        "quote": str(getattr(getattr(inst, "quote_currency", None) or "", "") or ""),
        "price_precision": int(getattr(inst, "price_precision", 0) or 0),
        "qty_precision": int(getattr(inst, "qty_precision", 0) or 0),
        "tick_size": round(num(getattr(inst, "tick_size", 0)), 10),
        "lot_size": round(num(getattr(inst, "lot_size", 0)), 10),
        "is_active": bool(getattr(inst, "is_active", True)),
    }


def account_balances(account: Any) -> list[dict]:
    """Best-effort extraction of currency balances from a cached account."""
    out: list[dict] = []
    if account is None:
        return out
    balances = getattr(account, "balances", None)
    if balances is None:
        return out
    try:
        items = balances.items() if isinstance(balances, dict) else [
            (str(b.currency), b) for b in balances
        ]
    except Exception:
        return out
    for key, bal in items:
        try:
            total = getattr(bal, "total", None)
            free = getattr(bal, "free", None)
            locked = getattr(bal, "locked", None)
            out.append(
                {
                    "currency": str(getattr(bal, "currency", key)),
                    "total": round(num(total), 6),
                    "free": round(num(free) if free is not None else num(total), 6),
                    "locked": round(num(locked) if locked is not None else 0.0, 6),
                },
            )
        except Exception:
            continue
    return out


def bar_to_candle(bar: Any) -> dict:
    ts = getattr(bar, "ts_event", 0) or 0
    return {
        "time": int(ts // 1_000_000_000) if ts > 1e12 else now_ts(),
        "open": round(num(bar.open), 8),
        "high": round(num(bar.high), 8),
        "low": round(num(bar.low), 8),
        "close": round(num(bar.close), 8),
        "volume": round(num(bar.volume), 6),
    }


def quote_to_tick(q: Any) -> dict:
    ts = getattr(q, "ts_event", 0) or 0
    return {
        "time": int(ts // 1_000_000_000) if ts > 1e12 else now_ts(),
        "bid": round(num(q.bid_price), 8),
        "ask": round(num(q.ask_price), 8),
        "size": round(num(getattr(q, "bid_size", 0)), 8),
    }
