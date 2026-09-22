import random
import time
import uuid
from decimal import Decimal
from typing import Any

from nautilus_trader.backtest import BacktestEngine
from nautilus_trader.config import BacktestEngineConfig
from nautilus_trader.config import StrategyConfig
from nautilus_trader.indicators import ExponentialMovingAverage
from nautilus_trader.model import AccountType
from nautilus_trader.model import Bar
from nautilus_trader.model import BarType
from nautilus_trader.model import Currency
from nautilus_trader.model import Money
from nautilus_trader.model import OrderFilled
from nautilus_trader.model import OrderSide
from nautilus_trader.model import OrderSubmitted
from nautilus_trader.model import OmsType
from nautilus_trader.model import PositionChanged
from nautilus_trader.model import PositionClosed
from nautilus_trader.model import PositionOpened
from nautilus_trader.model import TimeInForce
from nautilus_trader.model import TraderId
from nautilus_trader.model import Venue
from nautilus_trader.testkit.providers import TestInstrumentProvider
from nautilus_trader.trading import Strategy

from .hub import hub


def _num(x: Any) -> float:
    if x is None:
        return 0.0
    for attr in ("as_f64", "__float__"):
        try:
            if attr == "as_f64" and hasattr(x, "as_f64"):
                return float(x.as_f64())
            if attr == "__float__":
                return float(x)
        except Exception:
            continue
    try:
        return float(str(x))
    except Exception:
        return 0.0


def _symbol(instrument_id: Any) -> str:
    return str(instrument_id).split(".")[0]


def _event(kind: str, text: str, tone: str = "info") -> dict:
    return {
        "type": "event",
        "event": {
            "id": uuid.uuid4().hex[:8],
            "ts": int(time.time()),
            "type": kind,
            "text": text,
            "tone": tone,
        },
    }


class GuiBridgeConfig(StrategyConfig):
    def __init__(
        self,
        *,
        instrument_id: Any,
        bar_type: str,
        trade_size: Decimal = Decimal(100_000),
        fast_ema_period: int = 10,
        slow_ema_period: int = 20,
        **_kwargs: object,
    ) -> None:
        super().__init__()
        self.instrument_id = instrument_id
        self.bar_type = bar_type
        self.trade_size = trade_size
        self.fast_ema_period = fast_ema_period
        self.slow_ema_period = slow_ema_period


class GuiBridgeStrategy(Strategy):
    """EMA cross strategy that streams its lifecycle into the GUI event hub."""

    def __init__(self, config: GuiBridgeConfig) -> None:
        super().__init__(config)
        self.fast_ema = ExponentialMovingAverage(config.fast_ema_period)
        self.slow_ema = ExponentialMovingAverage(config.slow_ema_period)
        self.fills: list[dict] = []
        self.orders: list[dict] = []
        self.closed_positions: list[dict] = []
        self.bars: list[dict] = []
        self.last_close: dict[str, float] = {}

    def on_start(self) -> None:
        bar_type = BarType.from_str(self.config.bar_type)
        self.register_indicator_for_bars(bar_type, self.fast_ema)
        self.register_indicator_for_bars(bar_type, self.slow_ema)
        self.subscribe_bars(bar_type)
        hub.push(_event("engine", "GuiBridge strategy started — streaming to GUI", "ok"))

    def on_bar(self, bar: Bar) -> None:
        if not self.indicators_initialized():
            return

        sym = _symbol(bar.bar_type.instrument_id)
        close = _num(bar.close)
        self.last_close[sym] = close
        candle = {
            "time": int(bar.ts_event // 1_000_000_000),
            "open": round(_num(bar.open), 5),
            "high": round(_num(bar.high), 5),
            "low": round(_num(bar.low), 5),
            "close": round(close, 5),
            "volume": round(_num(bar.volume), 2),
        }
        self.bars.append(candle)
        hub.push({"type": "candle", "symbol": sym, "candle": candle})

        signal = None
        if self.fast_ema.value >= self.slow_ema.value:
            if self.portfolio.is_net_flat(self.config.instrument_id):
                signal = "BUY"
                self.buy()
            elif self.portfolio.is_net_short(self.config.instrument_id):
                self.close_all_positions(self.config.instrument_id)
                self.buy()
                signal = "REVERSE_LONG"
        elif self.fast_ema.value < self.slow_ema.value:
            if self.portfolio.is_net_flat(self.config.instrument_id):
                signal = "SELL"
                self.sell()
            elif self.portfolio.is_net_long(self.config.instrument_id):
                self.close_all_positions(self.config.instrument_id)
                self.sell()
                signal = "REVERSE_SHORT"

        if signal:
            hub.push(
                _event(
                    "signal",
                    f"EMA cross {signal} on {sym} @ {close:.5f} "
                    f"(fast {self.fast_ema.value:.5f} / slow {self.slow_ema.value:.5f})",
                    "ok" if signal == "BUY" else "warn",
                )
            )

    def buy(self) -> None:
        instrument = self.cache.instrument(self.config.instrument_id)
        order = self.order_factory.market(
            self.config.instrument_id,
            OrderSide.BUY,
            instrument.make_qty(self.config.trade_size),
            time_in_force=TimeInForce.GTC,
        )
        self.submit_order(order)

    def sell(self) -> None:
        instrument = self.cache.instrument(self.config.instrument_id)
        order = self.order_factory.market(
            self.config.instrument_id,
            OrderSide.SELL,
            instrument.make_qty(self.config.trade_size),
            time_in_force=TimeInForce.GTC,
        )
        self.submit_order(order)

    def on_order_submitted(self, event: OrderSubmitted) -> None:
        cached = self.cache.order(event.client_order_id)
        side = "buy"
        qty = 0.0
        if cached is not None:
            side = "buy" if cached.side == OrderSide.BUY else "sell"
            qty = round(_num(cached.quantity), 4)
        order = {
            "id": str(event.client_order_id),
            "symbol": _symbol(event.instrument_id),
            "side": side,
            "type": "MARKET",
            "qty": qty,
            "price": 0.0,
            "status": "SUBMITTED",
            "strategy": str(self.strategy_id),
            "created_at": int(event.ts_event // 1_000_000_000),
        }
        self.orders.insert(0, order)
        hub.push({"type": "order", "order": order})

    def on_order_filled(self, event: OrderFilled) -> None:
        side = str(event.order_side)
        side = "buy" if "BUY" in side else "sell"
        fill = {
            "id": str(event.trade_id),
            "symbol": _symbol(event.instrument_id),
            "side": side,
            "qty": round(_num(event.last_qty), 4),
            "price": round(_num(event.last_px), 5),
            "fee": round(_num(event.commission), 4),
            "ts": int(event.ts_event // 1_000_000_000),
            "strategy": str(self.strategy_id),
        }
        self.fills.insert(0, fill)
        hub.push({"type": "fill", "fill": fill})
        hub.push(
            _event(
                "fill",
                f"{side.upper()} {fill['qty']} {fill['symbol']} @ {fill['price']}",
                "ok" if side == "buy" else "warn",
            )
        )

    def on_position_opened(self, event: PositionOpened) -> None:
        hub.push(
            _event(
                "position",
                f"Position opened {event.side} {_num(event.quantity):.4f} "
                f"{_symbol(event.instrument_id)} @ {_num(event.avg_px_open):.5f}",
                "ok",
            )
        )
        self._push_positions()

    def on_position_changed(self, event: PositionChanged) -> None:
        self._push_positions()

    def on_position_closed(self, event: PositionClosed) -> None:
        closed = {
            "id": str(event.position_id),
            "symbol": _symbol(event.instrument_id),
            "side": "buy" if str(event.entry).upper().endswith("BUY") else "sell",
            "qty": round(_num(getattr(event, "peak_quantity", 0) or event.quantity), 4),
            "entry_price": round(_num(event.avg_px_open), 5),
            "mark_price": round(_num(event.last_px), 5),
            "realized_pnl": round(_num(event.realized_pnl), 2),
            "opened_at": int(event.ts_opened // 1_000_000_000)
            if getattr(event, "ts_opened", None)
            else int(event.ts_event // 1_000_000_000),
            "closed_at": int(event.ts_closed // 1_000_000_000)
            if getattr(event, "ts_closed", None)
            else int(event.ts_event // 1_000_000_000),
            "strategy": str(self.strategy_id),
        }
        self.closed_positions.append(closed)
        pnl = closed["realized_pnl"]
        hub.push(
            _event(
                "position",
                f"Position closed {closed['symbol']} PnL {pnl:+,.2f} USD",
                "ok" if pnl >= 0 else "bad",
            )
        )
        self._push_positions()

    def _push_positions(self) -> None:
        out = []
        try:
            for p in self.cache.positions(self.strategy_id):
                out.append(
                    {
                        "id": str(p.position_id),
                        "symbol": _symbol(p.instrument_id),
                        "side": str(p.side).lower().replace("positionside.", ""),
                        "qty": abs(round(_num(p.quantity), 4)),
                        "entry_price": round(_num(p.avg_px_open), 5),
                        "mark_price": round(_num(p.last_px), 5),
                        "unrealized_pnl": round(_num(p.realized_pnl), 2),
                        "opened_at": int(p.ts_opened // 1_000_000_000)
                        if hasattr(p, "ts_opened")
                        else int(time.time()),
                        "strategy": str(self.strategy_id),
                    }
                )
        except Exception:
            pass
        hub.push({"type": "positions", "positions": out})

    def on_stop(self) -> None:
        self.close_all_positions(self.config.instrument_id)
        hub.push(_event("engine", "GuiBridge strategy stopped", "info"))


def _generate_bars(instrument, n_bars: int) -> list[Bar]:
    bar_type = BarType.from_str(f"{instrument.id}-1-MINUTE-LAST-EXTERNAL")
    price = 0.6500
    ts = (int(time.time()) - n_bars * 60) * 1_000_000_000
    bars: list[Bar] = []
    for i in range(n_bars):
        o = price
        c = max(0.1, price + random.gauss(0, 0.0011))
        h = max(o, c) * (1 + abs(random.gauss(0, 0.0004)))
        l = min(o, c) * (1 - abs(random.gauss(0, 0.0004)))
        bars.append(
            Bar(
                bar_type=bar_type,
                open=instrument.make_price(round(o, 5)),
                high=instrument.make_price(round(h, 5)),
                low=instrument.make_price(round(l, 5)),
                close=instrument.make_price(round(c, 5)),
                volume=instrument.make_qty(random.uniform(50, 500)),
                ts_event=ts + i * 60_000_000_000,
                ts_init=ts + i * 60_000_000_000,
            )
        )
        price = c
    return bars


def _to_epoch(v: Any) -> int | None:
    try:
        if hasattr(v, "timestamp"):
            return int(v.timestamp())
    except Exception:
        pass
    try:
        n = float(v)
        if n > 1e17:
            return int(n // 1_000_000_000)
        if n > 1e12:
            return int(n // 1_000)
        if n > 1e9:
            return int(n)
    except Exception:
        pass
    return None


def _equity_curve(account_rows: list[dict], start_balance: float) -> list[dict]:
    curve: list[dict] = []
    for row in account_rows:
        bal = None
        ts = None
        for k, v in row.items():
            lk = str(k).lower()
            if bal is None and (lk in ("total", "balance", "equity") or "balance" in lk):
                try:
                    bal = float(v)
                except Exception:
                    pass
            if ts is None and (lk in ("index", "time", "timestamp", "datetime", "ts_event") or "time" in lk):
                ts = _to_epoch(v)
        if bal is not None:
            curve.append({"time": ts or int(time.time()), "equity": round(bal, 2)})
    if not curve:
        now = int(time.time())
        curve = [{"time": now, "equity": round(start_balance, 2)}]
    return curve


def _max_drawdown(curve: list[dict]) -> float:
    peak = float("-inf")
    max_dd = 0.0
    for p in curve:
        v = p["equity"]
        peak = max(peak, v)
        if peak > 0:
            max_dd = min(max_dd, (v - peak) / peak * 100)
    return round(max_dd, 2)


def run_gui_backtest(params: dict) -> dict:
    n_bars = int(params.get("n_bars", 600))
    fast = int(params.get("fast_ema_period", 10))
    slow = int(params.get("slow_ema_period", 20))
    start_balance = float(params.get("starting_balance", 100_000))
    seed = params.get("seed")
    if seed is not None:
        random.seed(int(seed))

    started = time.time()
    engine = BacktestEngine(BacktestEngineConfig(trader_id=TraderId.from_str("GUI-001")))

    venue = Venue("SIM")
    usd = Currency.from_str("USD")
    engine.add_venue(
        venue=venue,
        oms_type=OmsType.NETTING,
        account_type=AccountType.MARGIN,
        base_currency=usd,
        starting_balances=[Money.from_str(f"{start_balance:.0f} USD")],
    )

    instrument = TestInstrumentProvider.default_fx_ccy("AUD/USD", venue)
    engine.add_instrument(instrument)

    bars = _generate_bars(instrument, n_bars)
    engine.add_data(bars)

    bar_type = BarType.from_str(f"{instrument.id}-1-MINUTE-LAST-EXTERNAL")
    strategy = GuiBridgeStrategy(
        GuiBridgeConfig(
            instrument_id=instrument.id,
            bar_type=str(bar_type),
            trade_size=Decimal(100_000),
            fast_ema_period=fast,
            slow_ema_period=slow,
        )
    )
    engine.add_strategy(strategy)

    hub.push(_event("engine", f"Backtest started: {n_bars} bars, EMA {fast}/{slow}", "ok"))
    engine.run()

    equity_curve: list[dict] = []
    try:
        account_df = engine.generate_account_report(venue=venue)
        rows = account_df.reset_index().to_dict(orient="records") if account_df is not None else []
        equity_curve = _equity_curve(rows, start_balance)
    except Exception:
        equity_curve = [{"time": int(time.time()), "equity": round(start_balance, 2)}]

    final_equity = equity_curve[-1]["equity"] if equity_curve else start_balance
    total_pnl = round(final_equity - start_balance, 2)
    closed = strategy.closed_positions
    wins = sum(1 for c in closed if c["realized_pnl"] >= 0)
    win_rate = round(wins / len(closed) * 100, 1) if closed else 0.0
    elapsed = round(time.time() - started, 2)

    engine.dispose()

    hub.push(
        _event(
            "engine",
            f"Backtest finished in {elapsed}s — PnL {total_pnl:+,.2f} USD, {len(closed)} trades",
            "ok" if total_pnl >= 0 else "bad",
        )
    )

    return {
        "status": "completed",
        "elapsed_sec": elapsed,
        "params": {
            "n_bars": n_bars,
            "fast_ema_period": fast,
            "slow_ema_period": slow,
            "starting_balance": start_balance,
        },
        "metrics": {
            "total_pnl": total_pnl,
            "final_equity": final_equity,
            "trades": len(closed),
            "win_rate": win_rate,
            "max_drawdown_pct": _max_drawdown(equity_curve),
            "fills": len(strategy.fills),
        },
        "equity_curve": equity_curve,
        "fills": strategy.fills[:40],
        "closed_positions": closed,
        "orders": strategy.orders[:20],
        "bars": strategy.bars,
    }
