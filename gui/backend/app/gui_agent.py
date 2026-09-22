"""GUI bridge agent: runs inside a LiveNode and streams cache/portfolio state to the GUI.

All Nautilus cache/portfolio/order access happens on the engine core thread via
clock timers and event handlers — never from FastAPI worker threads.
"""

from __future__ import annotations

import math
import uuid
from collections import deque
from datetime import datetime, timedelta, timezone
from typing import Any

from nautilus_trader.config import StrategyConfig
from nautilus_trader.model import InstrumentId, OrderSide, TimeInForce
from nautilus_trader.trading import Strategy

from .hub import hub
from .serializers import (
    account_balances,
    fill_from_event,
    feed_event,
    instrument_to_dict,
    now_ts,
    num,
    order_to_dict,
    position_to_dict,
    symbol,
)
from .state import commands, live_store

TIF = {
    "GTC": TimeInForce.GTC,
    "IOC": TimeInForce.IOC,
    "FOK": TimeInForce.FOK,
    "GTD": TimeInForce.GTD,
    "DAY": TimeInForce.DAY,
}


def parse_expires_at(value: Any) -> int | None:
    if value is None or value == "":
        return None
    if isinstance(value, (int, float)):
        num_v = float(value)
        if num_v > 1e12:
            return int(num_v)
        return int(num_v * 1_000_000_000)
    s = str(value).strip()
    try:
        num_v = float(s)
    except ValueError:
        dt = datetime.fromisoformat(s.replace("Z", "+00:00"))
        if dt.tzinfo is None:
            dt = dt.replace(tzinfo=timezone.utc)
        return int(dt.timestamp() * 1_000_000_000)
    if num_v > 1e12:
        return int(num_v)
    return int(num_v * 1_000_000_000)


class GuiAgentConfig(StrategyConfig):
    def __init__(
        self,
        *,
        instrument_ids: list[str] | None = None,
        snapshot_interval_ms: int = 500,
        command_interval_ms: int = 250,
        **_kwargs: object,
    ) -> None:
        super().__init__()
        self.instrument_ids = instrument_ids or []
        self.snapshot_interval_ms = snapshot_interval_ms
        self.command_interval_ms = command_interval_ms


class GuiAgent(Strategy):
    """Streams live cache/portfolio state over the GUI hub and executes UI order commands."""

    def __init__(self, config: GuiAgentConfig) -> None:
        super().__init__(config)
        self._candles: dict[str, list[dict]] = {}
        self._candle_bucket: dict[str, dict] = {}
        self._fills: deque[dict] = deque(maxlen=100)
        self._orders_recent: deque[dict] = deque(maxlen=100)
        self._events: deque[dict] = deque(maxlen=120)
        self._equity_curve: list[dict] = []
        self._instruments: list[dict] = []
        self._tick_count = 0
        self._msg_count = 0
        self._msg_window = now_ts()
        self._msgs_per_sec = 0
        self._start_balance: float | None = None
        self._risk_state: str = "ACTIVE"  # ACTIVE | REDUCING | HALTED
        self._closed_pnls: list[float] = []

    # ------------------------------------------------------------------ lifecycle

    def on_start(self) -> None:
        for raw in self.config.instrument_ids:
            try:
                iid = InstrumentId.from_str(raw)
                self.subscribe_quotes(iid)
            except Exception as exc:
                self._push_event("agent", f"Subscribe failed for {raw}: {exc}", "bad")

        self.clock.set_timer(
            "gui_agent.snapshot",
            interval=timedelta(milliseconds=self.config.snapshot_interval_ms),
            callback=self._on_snapshot_timer,
        )
        self.clock.set_timer(
            "gui_agent.commands",
            interval=timedelta(milliseconds=self.config.command_interval_ms),
            callback=self._on_command_timer,
        )
        self._push_event("agent", "GUI agent started — streaming cache/portfolio state", "ok")
        self._push_node()

    def on_stop(self) -> None:
        with_errors = commands.drain()
        if with_errors:
            self._push_event("agent", f"Dropped {len(with_errors)} queued commands on stop", "warn")
        self._push_event("agent", "GUI agent stopped", "info")

    def on_dispose(self) -> None:
        pass

    # ------------------------------------------------------------------ timers

    def _on_snapshot_timer(self, event: Any) -> None:
        try:
            self._publish_snapshot()
        except Exception as exc:
            self._push_event("agent", f"Snapshot error: {exc}", "bad")

    def _on_command_timer(self, event: Any) -> None:
        for cmd in commands.drain():
            try:
                self._execute(cmd)
                cid = cmd.get("command_id")
                if cid and cmd.get("action") != "submit":
                    # submit acks are pushed from _cmd_submit with the order id
                    hub.push(
                        {
                            "type": "order_ack",
                            "command_id": cid,
                            "action": cmd.get("action"),
                            "status": "accepted",
                        },
                    )
            except Exception as exc:
                cid = cmd.get("command_id")
                if cid:
                    hub.push(
                        {
                            "type": "order_reject",
                            "command_id": cid,
                            "action": cmd.get("action"),
                            "status": "rejected",
                            "reason": str(exc),
                        },
                    )
                self._push_event("order", f"Command failed: {exc}", "bad")

    # ------------------------------------------------------------------ commands

    def _execute(self, cmd: dict) -> None:
        action = cmd.get("action")
        if action == "submit":
            self._cmd_submit(cmd)
        elif action == "cancel":
            self._cmd_cancel(cmd)
        elif action == "modify":
            self._cmd_modify(cmd)
        elif action == "cancel_all":
            if cmd.get("instrument_id"):
                iid = InstrumentId.from_str(cmd["instrument_id"])
                self.cancel_all_orders(iid)
                self._push_event("order", f"Cancel all orders on {cmd['instrument_id']}", "warn")
            else:
                ids = []
                try:
                    for o in self.cache.orders_open():
                        if o.instrument_id not in ids:
                            ids.append(o.instrument_id)
                except Exception:
                    pass
                for iid in ids:
                    self.cancel_all_orders(iid)
                self._push_event("order", f"Cancel all open orders ({len(ids)} instruments)", "warn")
        elif action == "close_position":
            iid = InstrumentId.from_str(cmd["instrument_id"])
            pos = next(
                (
                    p
                    for p in (
                        self.cache.positions_open()
                        if hasattr(self.cache, "positions_open")
                        else self.cache.positions()
                    )
                    if p.instrument_id == iid and not p.is_closed
                ),
                None,
            )
            if pos is None:
                raise ValueError(f"No open position on {cmd['instrument_id']}")
            self.close_position(pos)
            self._push_event("position", f"Close position on {cmd['instrument_id']}", "warn")
        elif action == "close_all":
            closed = 0
            try:
                for p in list(
                    self.cache.positions_open()
                    if hasattr(self.cache, "positions_open")
                    else self.cache.positions()
                ):
                    if not p.is_closed:
                        self.close_position(p)
                        closed += 1
            except Exception as exc:
                raise ValueError(f"Close all failed: {exc}") from exc
            self._push_event("position", f"Close all positions ({closed})", "warn")
        elif action == "risk_state":
            self._risk_state = str(cmd.get("state", "ACTIVE")).upper()
            self._push_event(
                "risk",
                f"Trading state set to {self._risk_state}",
                "bad" if self._risk_state == "HALTED" else "warn",
            )
        else:
            raise ValueError(f"Unknown action {action!r}")

    def _gate_by_risk_state(self, iid: InstrumentId, side: OrderSide) -> None:
        """Deny orders that the kill-switch state does not permit."""
        if self._risk_state == "HALTED":
            raise RuntimeError("Trading state is HALTED — order rejected")
        if self._risk_state == "REDUCING":
            # Only allow orders that reduce current exposure.
            net_long = self.portfolio.is_net_long(iid)
            net_short = self.portfolio.is_net_short(iid)
            if side == OrderSide.BUY and not net_short:
                raise RuntimeError("Trading state is REDUCING — new longs denied")
            if side == OrderSide.SELL and not net_long:
                raise RuntimeError("Trading state is REDUCING — new shorts denied")

    def _cmd_submit(self, cmd: dict) -> None:
        iid = InstrumentId.from_str(cmd["instrument_id"])
        instrument = self.cache.instrument(iid)
        if instrument is None:
            raise ValueError(f"Unknown instrument {cmd['instrument_id']}")
        side = OrderSide.BUY if str(cmd.get("side", "")).lower() == "buy" else OrderSide.SELL
        qty = instrument.make_qty(str(cmd["qty"]))
        tif = TIF.get(str(cmd.get("tif", "GTC")).upper(), TimeInForce.GTC)
        tif_raw = str(cmd.get("tif", "GTC")).upper()
        order_type = str(cmd.get("type", "MARKET")).upper()
        expire_time: int | None = parse_expires_at(cmd.get("expires_at"))
        if tif_raw == "GTD" and expire_time is None:
            raise ValueError("GTD requires expires_at")
        use_expire = expire_time is not None and tif_raw in ("GTD", "DAY")

        self._gate_by_risk_state(iid, side)

        if order_type == "LIMIT":
            if cmd.get("price") in (None, "", 0, "0"):
                raise ValueError("Limit orders require a price")
            price = instrument.make_price(str(cmd["price"]))
            order = self.order_factory.limit(
                iid,
                side,
                qty,
                price,
                time_in_force=tif,
                expire_time=expire_time if use_expire else None,
            )
        elif order_type == "STOP_MARKET":
            if cmd.get("trigger_price") in (None, "", 0, "0"):
                raise ValueError("STOP_MARKET orders require a trigger price")
            trigger = instrument.make_price(str(cmd["trigger_price"]))
            order = self.order_factory.stop_market(
                iid,
                side,
                qty,
                trigger,
                time_in_force=tif,
                expire_time=expire_time if use_expire else None,
            )
        elif order_type == "STOP_LIMIT":
            if cmd.get("price") in (None, "", 0, "0"):
                raise ValueError("STOP_LIMIT orders require a price")
            if cmd.get("trigger_price") in (None, "", 0, "0"):
                raise ValueError("STOP_LIMIT orders require a trigger price")
            price = instrument.make_price(str(cmd["price"]))
            trigger = instrument.make_price(str(cmd["trigger_price"]))
            order = self.order_factory.stop_limit(
                iid,
                side,
                qty,
                price,
                trigger,
                time_in_force=tif,
                expire_time=expire_time if use_expire else None,
            )
        else:
            order = self.order_factory.market(iid, side, qty, time_in_force=tif)

        self.submit_order(order)
        detail = ""
        if order_type in ("LIMIT", "STOP_LIMIT") and cmd.get("price"):
            detail += f" @ {cmd.get('price')}"
        if order_type in ("STOP_MARKET", "STOP_LIMIT") and cmd.get("trigger_price"):
            detail += f" trigger {cmd.get('trigger_price')}"
        if cmd.get("command_id"):
            hub.push(
                {
                    "type": "order_ack",
                    "command_id": cmd["command_id"],
                    "action": "submit",
                    "status": "accepted",
                    "order_id": str(order.client_order_id),
                },
            )
        self._push_event(
            "order",
            f"Submit {order_type} {side.name} {cmd['qty']} {cmd['instrument_id']}{detail}",
            "ok" if side == OrderSide.BUY else "warn",
        )

    def _cmd_cancel(self, cmd: dict) -> None:
        order = self.cache.order(cmd["order_id"])
        if order is None:
            raise ValueError(f"Order not found: {cmd['order_id']}")
        self.cancel_order(order)
        self._push_event("order", f"Cancel {cmd['order_id']}", "warn")

    def _cmd_modify(self, cmd: dict) -> None:
        order = self.cache.order(cmd["order_id"])
        if order is None:
            raise ValueError(f"Order not found: {cmd['order_id']}")
        instrument = self.cache.instrument(order.instrument_id)
        if instrument is None:
            raise ValueError("Instrument not in cache")
        qty = instrument.make_qty(str(cmd["qty"])) if cmd.get("qty") else order.quantity
        price = instrument.make_price(str(cmd["price"])) if cmd.get("price") else order.price
        self.modify_order(order, qty, price)
        self._push_event("order", f"Modify {cmd['order_id']}", "info")

    # ------------------------------------------------------------------ market data → candles

    def on_quote(self, quote: Any) -> None:
        self._tick_count += 1
        sym = symbol(quote.instrument_id)
        bid = num(quote.bid_price)
        ask = num(quote.ask_price)
        mid = (bid + ask) / 2 if bid and ask else (bid or ask)
        if not mid:
            return

        ts = quote.ts_event or 0
        epoch = int(ts // 1_000_000_000) if ts > 1e12 else now_ts()
        minute = epoch - (epoch % 60)

        bucket = self._candle_bucket.get(sym)
        if bucket is None or bucket["time"] != minute:
            if bucket is not None:
                series = self._candles.setdefault(sym, [])
                series.append(dict(bucket))
                del series[:-240]
                hub.push({"type": "candle", "symbol": sym, "candle": dict(bucket)})
            bucket = {
                "time": minute,
                "open": round(mid, 8),
                "high": round(mid, 8),
                "low": round(mid, 8),
                "close": round(mid, 8),
                "volume": 0.0,
            }
            self._candle_bucket[sym] = bucket
        else:
            bucket["high"] = max(bucket["high"], round(mid, 8))
            bucket["low"] = min(bucket["low"], round(mid, 8))
            bucket["close"] = round(mid, 8)
            bucket["volume"] = round(bucket["volume"] + num(getattr(quote, "bid_size", 0)), 6)
            hub.push({"type": "candle_update", "symbol": sym, "candle": dict(bucket)})

    # ------------------------------------------------------------------ execution events

    def on_order_submitted(self, event: Any) -> None:
        cached = self.cache.order(event.client_order_id)
        if cached is None:
            return
        d = order_to_dict(cached)
        self._orders_recent.appendleft(d)
        hub.push({"type": "order", "order": d})

    def on_order_filled(self, event: Any) -> None:
        cached = self.cache.order(event.client_order_id)
        strat = str(cached.strategy_id) if cached is not None else str(self.strategy_id)
        d = fill_from_event(event, strategy=strat)
        self._fills.appendleft(d)
        hub.push({"type": "fill", "fill": d})
        self._push_event(
            "fill",
            f"{d['side'].upper()} {d['qty']} {d['symbol']} @ {d['price']}",
            "ok" if d["side"] == "buy" else "warn",
        )
        if cached is not None:
            od = order_to_dict(cached)
            self._orders_recent.appendleft(od)
            hub.push({"type": "order", "order": od})
        hub.push({"type": "positions", "positions": self._positions()})

    def on_order_canceled(self, event: Any) -> None:
        cached = self.cache.order(event.client_order_id)
        if cached is not None:
            od = order_to_dict(cached)
            self._orders_recent.appendleft(od)
            hub.push({"type": "order", "order": od})
        self._push_event("order", f"Order canceled {event.client_order_id}", "info")

    def on_order_rejected(self, event: Any) -> None:
        self._push_event("order", f"Order rejected {event.client_order_id}", "bad")

    def on_order_denied(self, event: Any) -> None:
        self._push_event("order", f"Order denied {event.client_order_id}", "bad")

    def on_position_opened(self, event: Any) -> None:
        self._push_event(
            "position",
            f"Position opened {symbol(event.instrument_id)} qty {num(event.quantity):.6f}",
            "ok",
        )
        hub.push({"type": "positions", "positions": self._positions()})

    def on_position_changed(self, event: Any) -> None:
        hub.push({"type": "positions", "positions": self._positions()})

    def on_position_closed(self, event: Any) -> None:
        pnl = num(getattr(event, "realized_pnl", 0))
        self._closed_pnls.append(pnl)
        del self._closed_pnls[:-500]
        self._push_event(
            "position",
            f"Position closed {symbol(event.instrument_id)} PnL {pnl:+,.4f}",
            "ok" if pnl >= 0 else "bad",
        )
        hub.push({"type": "positions", "positions": self._positions()})

    # ------------------------------------------------------------------ snapshot

    def _positions(self) -> list[dict]:
        out = []
        try:
            for p in self.cache.positions():
                out.append(position_to_dict(p))
        except Exception:
            pass
        return out

    def _orders(self) -> list[dict]:
        out: list[dict] = []
        seen: set[str] = set()
        try:
            for o in self.cache.orders_open():
                d = order_to_dict(o)
                seen.add(d["id"])
                out.append(d)
        except Exception:
            pass
        for d in self._orders_recent:
            if d["id"] not in seen:
                out.append(d)
                seen.add(d["id"])
            if len(out) >= 50:
                break
        return out

    def _balances(self) -> list[dict]:
        rows: list[dict] = []
        try:
            for acc in self.cache.accounts() if hasattr(self.cache, "accounts") else []:
                rows.extend(account_balances(acc))
            if not rows:
                for venue in {i.venue for i in self.cache.instruments()}:
                    acc = self.cache.account_for_venue(venue)
                    rows.extend(account_balances(acc))
        except Exception:
            pass
        # de-duplicate by currency, prefer first
        seen: set[str] = set()
        out: list[dict] = []
        for r in rows:
            if r["currency"] not in seen:
                seen.add(r["currency"])
                out.append(r)
        return out

    def _equity(self) -> float:
        try:
            eq = self.portfolio.equity()
            if eq is not None:
                return num(eq)
        except Exception:
            pass
        balances = self._balances()
        if balances:
            return sum(b["total"] for b in balances if b["currency"] in ("USDT", "USD", "USDC")) or sum(
                b["total"] for b in balances
            )
        return 0.0

    def _summary(self) -> dict:
        equity = self._equity()
        if self._start_balance is None and equity > 0:
            self._start_balance = equity
        positions = self._positions()
        unreal = sum(p["unrealized_pnl"] for p in positions)
        realized = 0.0
        try:
            realized = num(self.portfolio.realized_pnl())
        except Exception:
            try:
                realized = num(self.portfolio.total_pnl())
            except Exception:
                realized = 0.0
        peak = max((p["equity"] for p in self._equity_curve), default=equity)
        dd = (equity - peak) / peak * 100 if peak else 0.0
        now = now_ts()
        if now != self._msg_window:
            self._msgs_per_sec = self._msg_count
            self._msg_count = 0
            self._msg_window = now
        cash = 0.0
        balances = self._balances()
        if balances:
            cash = next((b["free"] for b in balances if b["currency"] in ("USDT", "USD")), balances[0]["total"])
        wins = sum(1 for p in self._closed_pnls if p > 0)
        n_closed = len(self._closed_pnls)
        win_rate = round(wins / n_closed * 100, 1) if n_closed else 0.0
        sharpe = self._sharpe()
        return {
            "equity": round(equity, 2),
            "cash": round(cash, 2),
            "unrealized_pnl": round(unreal, 2),
            "realized_pnl": round(realized, 2),
            "open_positions": len(positions),
            "win_rate": win_rate,
            "drawdown_pct": round(dd, 2),
            "sharpe": sharpe,
            "latency_ms": 0.0,
            "messages_per_sec": self._msgs_per_sec,
            "ticks": self._tick_count,
            "risk_state": self._risk_state,
        }

    def _sharpe(self) -> float:
        """Annualized Sharpe from the live equity curve (0 if not enough data)."""
        curve = self._equity_curve
        if len(curve) < 3:
            return 0.0
        rets = []
        for i in range(1, len(curve)):
            prev = curve[i - 1]["equity"]
            if prev:
                rets.append((curve[i]["equity"] - prev) / prev)
        if len(rets) < 2:
            return 0.0
        mean = sum(rets) / len(rets)
        var = sum((r - mean) ** 2 for r in rets) / len(rets)
        std = math.sqrt(var)
        if std == 0:
            return 0.0
        return round((mean / std) * math.sqrt(252), 2)

    def _refresh_instruments(self) -> None:
        try:
            self._instruments = [instrument_to_dict(i) for i in self.cache.instruments()]
        except Exception:
            self._instruments = []

    def _strategy_rows(self) -> list[dict]:
        rows = [
            {
                "name": "GuiAgent",
                "symbol": ", ".join(self.config.instrument_ids) or "—",
                "status": "running",
                "pnl": 0.0,
                "trades": 0,
                "ema_fast": 0,
                "ema_slow": 0,
            },
        ]
        try:
            ids = self.cache.strategy_ids() if hasattr(self.cache, "strategy_ids") else []
            for sid in ids:
                name = str(sid)
                if "GUI_AGENT" in name.upper():
                    continue
                rows.append(
                    {
                        "name": name,
                        "symbol": ", ".join(self.config.instrument_ids) or "—",
                        "status": "running",
                        "pnl": 0.0,
                        "trades": 0,
                        "ema_fast": 0,
                        "ema_slow": 0,
                    },
                )
        except Exception:
            pass
        return rows

    def _publish_snapshot(self) -> None:
        summary = self._summary()
        equity = summary["equity"]
        if not self._equity_curve or self._equity_curve[-1]["equity"] != equity:
            self._equity_curve.append({"time": now_ts(), "equity": equity})
            del self._equity_curve[:-400]
            hub.push({"type": "equity", "point": {"time": now_ts(), "equity": equity}})

        self._refresh_instruments()
        # flush any partial candle bucket so charts show the forming bar
        for sym, bucket in self._candle_bucket.items():
            series = self._candles.setdefault(sym, [])
            if series and series[-1]["time"] == bucket["time"]:
                series[-1] = dict(bucket)
            else:
                series.append(dict(bucket))
                del series[:-240]

        balances = self._balances()
        instruments = self._instruments
        orders = self._orders()
        positions = self._positions()
        symbols = sorted({i["symbol"] for i in instruments} | set(self._candles))

        self._msg_count += 1
        snap = {
            "type": "snapshot",
            "mode": "live",
            "summary": summary,
            "candles": {s: self._candles.get(s, [])[-240:] for s in symbols},
            "equity_curve": self._equity_curve[-300:],
            "positions": positions,
            "orders": orders,
            "fills": list(self._fills)[:15],
            "events": list(self._events)[:20],
            "strategies": self._strategy_rows(),
            "symbols": symbols or ["BTC/USD"],
            "account": {"balances": balances},
            "instruments": instruments,
        }
        live_store.set_snapshot(snap)
        hub.push(snap)
        hub.push({"type": "account", "balances": balances})

    def _push_event(self, kind: str, text: str, tone: str = "info") -> None:
        msg = feed_event(kind, text, tone)
        self._events.appendleft(msg["event"])
        hub.push(msg)

    def _push_node(self) -> None:
        hub.push({"type": "node", "node": live_store.get_node_status()})
