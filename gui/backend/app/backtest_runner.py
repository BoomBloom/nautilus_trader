"""Configurable backtest runs over the real Nautilus BacktestEngine.

Supports builtin strategies (EmaCross via quotes) and the streaming GUI EMA
bridge (bars), with synthetic or test-kit datasets. Events stream to the GUI
hub while the engine runs off-thread; reports are produced on completion.
"""

from __future__ import annotations

import random
import threading
import time
import uuid
from typing import Any

from .bridge import GuiBridgeConfig, GuiBridgeStrategy, _max_drawdown, _num
from .hub import hub
from .serializers import feed_event

# --------------------------------------------------------------------------- catalog

STRATEGY_CATALOG: list[dict[str, Any]] = [
    {
        "id": "gui_ema",
        "name": "GUI EMA Cross (streaming)",
        "kind": "bars",
        "description": "EMA crossover that streams candles, signals and fills into the dashboard live.",
        "fields": [
            {"key": "fast_ema_period", "label": "Fast EMA", "default": 10, "min": 2, "max": 200},
            {"key": "slow_ema_period", "label": "Slow EMA", "default": 20, "min": 3, "max": 400},
            {"key": "trade_size", "label": "Trade size", "default": 100000, "min": 1, "max": 1e12},
        ],
    },
    {
        "id": "ema_cross",
        "name": "Builtin EmaCross (quotes)",
        "kind": "quotes",
        "description": "NautilusTrader's built-in dual-EMA crossover driven by quote ticks.",
        "fields": [
            {"key": "fast_ema_period", "label": "Fast period", "default": 10, "min": 2, "max": 200},
            {"key": "slow_ema_period", "label": "Slow period", "default": 50, "min": 3, "max": 400},
            {"key": "trade_size", "label": "Trade size", "default": 100000, "min": 1, "max": 1e12},
        ],
    },
]

DATA_CATALOG: list[dict[str, Any]] = [
    {
        "id": "synthetic_fx",
        "name": "Synthetic AUD/USD 1-min bars",
        "kind": "bars",
        "strategies": ["gui_ema"],
        "description": "Random-walk FX bars on the SIM venue.",
    },
    {
        "id": "synthetic_eth",
        "name": "Synthetic ETHUSDT 1-min bars",
        "kind": "bars",
        "strategies": ["gui_ema"],
        "description": "Random-walk crypto bars on the BINANCE venue.",
    },
    {
        "id": "audusd_quotes",
        "name": "AUD/USD historical quotes (test kit)",
        "kind": "quotes",
        "strategies": ["ema_cross"],
        "description": "3,000 bundled quote ticks from the Nautilus test kit.",
    },
    {
        "id": "binance_ethusdt_trades",
        "name": "Binance ETHUSDT trade ticks (test kit)",
        "kind": "trades",
        "strategies": [],
        "description": "69k+ historical trade ticks — for future trade-driven strategies.",
    },
]


def _fmt_size(n: int) -> str:
    if n >= 1 << 20:
        return f"{n / (1 << 20):.1f} MB"
    if n >= 1 << 10:
        return f"{n / (1 << 10):.1f} KB"
    return f"{n} B"


def _detect_file_kind(path: str) -> str | None:
    """Return bars/quotes for OHLCV or bid/ask CSVs; None otherwise."""
    from pathlib import Path

    p = Path(path)
    if p.suffix.lower() != ".csv":
        return None
    try:
        with open(p, "r", encoding="utf-8", errors="replace") as fh:
            header = fh.readline().strip().lower()
    except OSError:
        return None
    cols = {c.strip() for c in header.split(",") if c.strip()}
    if {"open", "high", "low", "close"} <= cols:
        return "bars"
    if {"bid", "ask"} <= cols or {"bid_price", "ask_price"} <= cols:
        return "quotes"
    return None


def _file_data_sources(limit: int = 40) -> list[dict[str, Any]]:
    """Catalog files that look like bars/quotes, as runnable data sources."""
    from .catalog import list_catalog

    out: list[dict[str, Any]] = []
    seen: set[str] = set()
    try:
        files = list_catalog().get("files") or []
    except Exception:
        return out
    for f in files:
        path = str(f.get("abs_path") or "")
        if not path or path in seen:
            continue
        size = int(f.get("size_bytes") or 0)
        if size > 200 * (1 << 20):
            continue
        kind = _detect_file_kind(path)
        if kind is None:
            continue
        seen.add(path)
        rel = str(f.get("path") or f.get("name") or path)
        low = rel.lower()
        crypto = any(s in low for s in ("btc", "eth", "binance", "bybit", "okx", "crypto", "sol"))
        out.append(
            {
                "id": f"file:{path}",
                "name": f"File · {f.get('name') or rel}",
                "kind": kind,
                "strategies": ["gui_ema"] if kind == "bars" else ["ema_cross"],
                "description": f"{f.get('source', 'catalog')}/{rel} · {_fmt_size(size)}",
                "trade_size_default": 0.01 if crypto else 100000,
                "source": "catalog",
            },
        )
        if len(out) >= limit:
            break
    return out


def backtest_catalog() -> dict[str, Any]:
    file_sources = _file_data_sources()
    return {
        "strategies": STRATEGY_CATALOG,
        "data_sources": [*DATA_CATALOG, *file_sources],
    }


def _venue_and_instrument(path: str):
    from pathlib import Path

    from nautilus_trader.model import Venue
    from nautilus_trader.testkit.providers import TestInstrumentProvider

    low = Path(path).name.lower() + " " + str(path).lower()
    if any(s in low for s in ("binance", "bybit", "btc", "eth", "xbt", "crypto")):
        venue = Venue("BINANCE")
        if "btc" in low or "xbt" in low:
            instrument = TestInstrumentProvider.btcusdt_binance()
        else:
            instrument = TestInstrumentProvider.ethusdt_binance()
        return venue, instrument, "USDT"
    venue = Venue("SIM")
    if "gbp" in low:
        instrument = TestInstrumentProvider.gbpusd_sim()
    elif "jpy" in low and "usd" in low:
        instrument = TestInstrumentProvider.usdjpy_sim()
    else:
        instrument = TestInstrumentProvider.default_fx_ccy("AUD/USD", venue)
    return venue, instrument, "USD"


def _load_catalog_bars(
    path: str,
    instrument,
    n_bars: int,
    start_ts: int | None = None,
    end_ts: int | None = None,
) -> list:
    import pandas as pd

    from nautilus_trader.model import Bar, BarType

    df = pd.read_csv(path)
    df.columns = [str(c).strip().lower() for c in df.columns]
    for req in ("open", "high", "low", "close"):
        if req not in df.columns:
            raise ValueError(f"Missing OHLCV column {req!r} in {path}")
    time_col = next(
        (c for c in ("timestamp", "time", "datetime", "date", "ts") if c in df.columns),
        None,
    )
    vol_col = "volume" if "volume" in df.columns else None

    def _row_ts(rec: dict, i: int) -> int:
        if time_col:
            try:
                ts = pd.Timestamp(rec[time_col])
                return int(ts.timestamp())
            except Exception:
                pass
        return int(time.time()) - (len(df) - i) * 60

    if time_col and (start_ts is not None or end_ts is not None):
        keep = []
        for i, values in enumerate(df.itertuples(index=False, name=None)):
            rec = dict(zip(df.columns, values))
            t = _row_ts(rec, i)
            if start_ts is not None and t < start_ts:
                continue
            if end_ts is not None and t > end_ts:
                continue
            keep.append(i)
        if keep:
            df = df.iloc[keep]

    if n_bars and n_bars > 0 and len(df) > n_bars:
        df = df.iloc[-n_bars:]
    if df.empty:
        return []

    bar_type = BarType.from_str(f"{instrument.id}-1-MINUTE-LAST-EXTERNAL")
    precision = max(2, int(getattr(instrument, "price_precision", 8) or 8))
    cols = list(df.columns)
    bars: list = []
    start_ns = (int(time.time()) - len(df) * 60) * 1_000_000_000
    for i, values in enumerate(df.itertuples(index=False, name=None)):
        rec = dict(zip(cols, values))
        if time_col:
            try:
                ts = pd.Timestamp(rec[time_col])
                ts_ns = int(ts.timestamp() * 1e9)
            except Exception:
                ts_ns = start_ns + i * 60_000_000_000
        else:
            ts_ns = start_ns + i * 60_000_000_000
        vol = float(rec[vol_col] or 0) if vol_col else 1.0
        o = round(float(rec["open"]), precision)
        h = round(float(rec["high"]), precision)
        lo = round(float(rec["low"]), precision)
        c = round(float(rec["close"]), precision)
        if max(abs(o), abs(h), abs(lo), abs(c)) == 0.0:
            raise ValueError(
                f"Prices in {path} do not fit instrument {instrument.id} precision {precision}",
            )
        bars.append(
            Bar(
                bar_type=bar_type,
                open=instrument.make_price(o),
                high=instrument.make_price(h),
                low=instrument.make_price(lo),
                close=instrument.make_price(c),
                volume=instrument.make_qty(max(vol, 0.000001)),
                ts_event=ts_ns,
                ts_init=ts_ns,
            ),
        )
    return bars


def _load_catalog_quotes(
    path: str,
    instrument,
    n_ticks: int,
    start_ts: int | None = None,
    end_ts: int | None = None,
) -> list:
    import pandas as pd

    from nautilus_trader.model import Price, Quantity, QuoteTick

    df = pd.read_csv(path)
    df.columns = [str(c).strip().lower() for c in df.columns]
    bid_col = next((c for c in ("bid", "bid_price") if c in df.columns), None)
    ask_col = next((c for c in ("ask", "ask_price") if c in df.columns), None)
    if bid_col is None or ask_col is None:
        raise ValueError(f"Missing bid/ask columns in {path}")
    time_col = next(
        (c for c in ("timestamp", "time", "datetime", "date", "ts") if c in df.columns),
        None,
    )
    if n_ticks and n_ticks > 0 and len(df) > n_ticks:
        df = df.iloc[-n_ticks:]
    precision = max(2, int(getattr(instrument, "price_precision", 8) or 8))
    cols = list(df.columns)
    quotes: list = []
    start_ns = (int(time.time()) - len(df)) * 1_000_000_000
    for i, values in enumerate(df.itertuples(index=False, name=None)):
        rec = dict(zip(cols, values))
        if time_col:
            try:
                ts = pd.Timestamp(rec[time_col])
                ts_ns = int(ts.timestamp() * 1e9)
            except Exception:
                ts_ns = start_ns + i
        else:
            ts_ns = start_ns + i
        if start_ts is not None and ts_ns // 1_000_000_000 < start_ts:
            continue
        if end_ts is not None and ts_ns // 1_000_000_000 > end_ts:
            continue
        bid = float(rec[bid_col])
        ask = float(rec[ask_col])
        quotes.append(
            QuoteTick(
                instrument_id=instrument.id,
                bid_price=Price.from_str(f"{bid:.{precision}f}"),
                ask_price=Price.from_str(f"{ask:.{precision}f}"),
                bid_size=Quantity.from_str("100000"),
                ask_size=Quantity.from_str("100000"),
                ts_event=ts_ns,
                ts_init=ts_ns,
            ),
        )
    return quotes


# --------------------------------------------------------------------------- helpers


def _event(kind: str, text: str, tone: str = "info") -> dict:
    return feed_event(kind, text, tone)


def _generate_bars(instrument, n_bars: int, start_price: float, vol: float = 0.0011) -> list:
    from nautilus_trader.model import Bar, BarType

    bar_type = BarType.from_str(f"{instrument.id}-1-MINUTE-LAST-EXTERNAL")
    price = start_price
    ts = (int(time.time()) - n_bars * 60) * 1_000_000_000
    bars = []
    precision = max(2, int(getattr(instrument, "price_precision", 2) or 2))
    for i in range(n_bars):
        o = price
        c = price + random.gauss(0, price * vol)
        c = max(price * 0.5, c)
        h = max(o, c) * (1 + abs(random.gauss(0, vol / 3)))
        l = min(o, c) * (1 - abs(random.gauss(0, vol / 3)))
        bars.append(
            Bar(
                bar_type=bar_type,
                open=instrument.make_price(round(o, precision)),
                high=instrument.make_price(round(h, precision)),
                low=instrument.make_price(round(l, precision)),
                close=instrument.make_price(round(c, precision)),
                volume=instrument.make_qty(random.uniform(50, 500)),
                ts_event=ts + i * 60_000_000_000,
                ts_init=ts + i * 60_000_000_000,
            ),
        )
        price = c
    return bars


def _df_records(df: Any) -> list[dict]:
    if df is None:
        return []
    try:
        out = []
        rows = df.reset_index().to_dict(orient="records")
        for row in rows:
            rec = {}
            for k, v in row.items():
                if hasattr(v, "isoformat"):
                    try:
                        rec[str(k)] = int(v.timestamp()) if hasattr(v, "timestamp") else str(v)
                    except Exception:
                        rec[str(k)] = str(v)
                elif hasattr(v, "item"):
                    try:
                        rec[str(k)] = v.item()
                    except Exception:
                        rec[str(k)] = float(v) if isinstance(v, float) else str(v)
                elif isinstance(v, (int, float, str, bool)) or v is None:
                    rec[str(k)] = v
                else:
                    rec[str(k)] = str(v)
            out.append(rec)
        return out
    except Exception:
        return []


def _equity_from_account_report(df: Any, start_balance: float) -> list[dict]:
    curve: list[dict] = []
    if df is None:
        return [{"time": int(time.time()), "equity": round(start_balance, 2)}]
    try:
        reset = df.reset_index()
        cols = {str(c).lower(): c for c in reset.columns}
        time_col = next((cols[k] for k in ("index", "time", "timestamp") if k in cols), reset.columns[0])
        total_col = None
        for key in ("total", "total_base", "balance", "equity"):
            if key in cols:
                total_col = cols[key]
                break
        if total_col is None:
            for c in reset.columns:
                if "total" in str(c).lower() or "balance" in str(c).lower():
                    total_col = c
                    break
        if total_col is None:
            return [{"time": int(time.time()), "equity": round(start_balance, 2)}]
        for _, row in reset.iterrows():
            ts = row[time_col]
            if hasattr(ts, "timestamp"):
                epoch = int(ts.timestamp())
            else:
                epoch = int(time.time())
            curve.append({"time": epoch, "equity": round(float(row[total_col]), 2)})
    except Exception:
        return [{"time": int(time.time()), "equity": round(start_balance, 2)}]
    return curve or [{"time": int(time.time()), "equity": round(start_balance, 2)}]


# --------------------------------------------------------------------------- runner


class BacktestRunner:
    """Serializes backtest runs (one at a time) and keeps run history."""

    def __init__(self) -> None:
        self._lock = threading.Lock()
        self._running = False
        self._current: dict[str, Any] | None = None
        self._last_result: dict[str, Any] | None = None
        self._history: list[dict[str, Any]] = []

    # ------------------------------------------------------------------ status

    @property
    def running(self) -> bool:
        return self._running

    def status(self) -> dict[str, Any]:
        return {
            "running": self._running,
            "current": self._current,
            "last_result": self._last_result,
        }

    def history(self, limit: int = 20) -> list[dict[str, Any]]:
        return self._history[:limit]

    # ------------------------------------------------------------------ run

    def run(self, params: dict[str, Any]) -> dict[str, Any]:
        if not self._lock.acquire(blocking=False):
            raise RuntimeError("A backtest is already running")
        self._running = True
        self._current = {
            "id": uuid.uuid4().hex[:8],
            "strategy": params.get("strategy", "gui_ema"),
            "data_source": params.get("data_source", "synthetic_fx"),
            "started_at": int(time.time()),
        }
        hub.push(_event("engine", f"Backtest queued: {self._current['strategy']} / {self._current['data_source']}", "ok"))
        try:
            result = self._execute(dict(params), self._current["id"])
        except Exception as exc:
            hub.push(_event("engine", f"Backtest failed: {exc}", "bad"))
            self._current = None
            self._running = False
            self._lock.release()
            raise
        summary = {
            "id": self._current["id"],
            "strategy": self._current["strategy"],
            "data_source": self._current["data_source"],
            "elapsed_sec": result.get("elapsed_sec", 0),
            "metrics": result.get("metrics", {}),
            "finished_at": int(time.time()),
            "params": result.get("params", {}),
        }
        self._history.insert(0, summary)
        del self._history[50:]
        self._last_result = result
        self._current = None
        self._running = False
        self._lock.release()
        return result

    # ------------------------------------------------------------------ internals

    def _execute(self, params: dict[str, Any], run_id: str) -> dict[str, Any]:
        from decimal import Decimal

        from nautilus_trader.backtest import BacktestEngine
        from nautilus_trader.config import BacktestEngineConfig, LoggerConfig, RiskEngineConfig
        from nautilus_trader.model import (
            AccountType,
            Money,
            OmsType,
            TraderId,
            Venue,
        )
        from nautilus_trader.testkit.providers import TestDataProvider, TestInstrumentProvider

        strategy_id = str(params.get("strategy", "gui_ema"))
        data_id = str(params.get("data_source", "synthetic_fx"))
        n_bars = int(params.get("n_bars", 600))
        fast = int(params.get("fast_ema_period", 10))
        slow = int(params.get("slow_ema_period", 20))
        trade_size = params.get("trade_size", 100000)
        start_balance = float(params.get("starting_balance", 100_000))
        seed = params.get("seed")
        if seed is not None:
            random.seed(int(seed))

        account_type_raw = str(params.get("account_type", "MARGIN")).upper()
        if account_type_raw not in ("CASH", "MARGIN"):
            raise ValueError(f"account_type must be CASH or MARGIN, got {account_type_raw!r}")
        start_ts = _parse_epoch(params.get("start_ts"))
        end_ts = _parse_epoch(params.get("end_ts"))
        if start_ts is not None and end_ts is not None and start_ts > end_ts:
            raise ValueError("start_ts must be <= end_ts")

        file_path = data_id[5:] if data_id.startswith("file:") else None
        if file_path is not None:
            from pathlib import Path

            p = Path(file_path)
            if not p.is_file():
                raise ValueError(f"Catalog data file not found: {file_path!r}")
            file_kind = _detect_file_kind(str(p))
            if file_kind is None:
                raise ValueError(f"File is not OHLCV bars or bid/ask quotes: {p.name}")
            data_meta = {
                "id": data_id,
                "kind": file_kind,
                "strategies": ["gui_ema"] if file_kind == "bars" else ["ema_cross"],
            }
        else:
            data_meta = next((d for d in DATA_CATALOG if d["id"] == data_id), None)
        if data_meta is None:
            raise ValueError(f"Unknown data source {data_id!r}")
        if strategy_id not in data_meta["strategies"] and data_meta["strategies"]:
            raise ValueError(f"Data source {data_id!r} does not support strategy {strategy_id!r}")

        started = time.time()
        hub.push(_event("engine", f"Building engine — {strategy_id} on {data_id}", "ok"))

        engine = BacktestEngine(
            BacktestEngineConfig(
                trader_id=TraderId.from_str("GUI-BT-001"),
                risk_engine=RiskEngineConfig(
                    bypass=bool(params.get("risk_bypass", False)),
                ),
                logging=LoggerConfig(bypass_logging=True),
            ),
        )

        # ---------------------------------------------------------------- venue + data
        venue = Venue("SIM")
        instrument = None
        bars: list = []
        quotes: list = []
        trades: list = []

        account_type = AccountType.MARGIN if account_type_raw == "MARGIN" else AccountType.CASH

        if file_path is not None:
            venue, instrument, ccy = _venue_and_instrument(file_path)
            engine.add_venue(
                venue=venue,
                oms_type=OmsType.NETTING,
                account_type=account_type,
                base_currency=None,
                starting_balances=[Money.from_str(f"{start_balance:.0f} {ccy}")],
            )
            engine.add_instrument(instrument)
            if data_meta["kind"] == "bars":
                bars = _load_catalog_bars(file_path, instrument, n_bars, start_ts, end_ts)
            else:
                quotes = _load_catalog_quotes(file_path, instrument, max(500, n_bars), start_ts, end_ts)
            if not bars and not quotes:
                raise ValueError("No bars/quotes in the selected date range")
        elif data_id == "synthetic_fx":
            venue = Venue("SIM")
            engine.add_venue(
                venue=venue,
                oms_type=OmsType.NETTING,
                account_type=account_type,
                base_currency=None,
                starting_balances=[Money.from_str(f"{start_balance:.0f} USD")],
            )
            instrument = TestInstrumentProvider.default_fx_ccy("AUD/USD", venue)
            engine.add_instrument(instrument)
            bars = _generate_bars(instrument, n_bars, start_price=0.6500, vol=0.0011)
        elif data_id == "synthetic_eth":
            from nautilus_trader.model import Currency

            venue = Venue("BINANCE")
            engine.add_venue(
                venue=venue,
                oms_type=OmsType.NETTING,
                account_type=account_type,
                base_currency=None,
                starting_balances=[Money.from_str(f"{start_balance:.0f} USDT")],
            )
            instrument = TestInstrumentProvider.ethusdt_binance()
            engine.add_instrument(instrument)
            bars = _generate_bars(instrument, n_bars, start_price=3400.0, vol=0.0018)
            _ = Currency  # noqa: F841
        elif data_id == "audusd_quotes":
            venue = Venue("SIM")
            engine.add_venue(
                venue=venue,
                oms_type=OmsType.NETTING,
                account_type=account_type,
                base_currency=None,
                starting_balances=[Money.from_str(f"{start_balance:.0f} USD")],
            )
            instrument = TestInstrumentProvider.default_fx_ccy("AUD/USD", venue)
            engine.add_instrument(instrument)
            quotes = TestDataProvider.audusd_quotes(count=max(500, n_bars))
        elif data_id == "binance_ethusdt_trades":
            venue = Venue("BINANCE")
            engine.add_venue(
                venue=venue,
                oms_type=OmsType.NETTING,
                account_type=account_type,
                base_currency=None,
                starting_balances=[Money.from_str(f"{start_balance:.0f} USDT")],
            )
            instrument = TestInstrumentProvider.ethusdt_binance()
            engine.add_instrument(instrument)
            trades = TestDataProvider.trades_from_binance_csv(
                instrument=instrument,
                csv_name="binance/ethusdt-trades.csv",
            )
        else:
            raise ValueError(f"Unhandled data source {data_id!r}")

        if bars:
            engine.add_data(bars)
        if quotes:
            engine.add_data(quotes)
        if trades:
            engine.add_data(trades)

        # ---------------------------------------------------------------- strategy
        strategy_obj = None
        if strategy_id == "gui_ema":
            if not bars:
                raise ValueError("GUI EMA bridge requires a bar data source")
            bar_type = str(bars[0].bar_type) if hasattr(bars[0], "bar_type") else None
            from nautilus_trader.model import BarType

            bar_type = BarType.from_str(f"{instrument.id}-1-MINUTE-LAST-EXTERNAL")
            strategy_obj = GuiBridgeStrategy(
                GuiBridgeConfig(
                    instrument_id=instrument.id,
                    bar_type=str(bar_type),
                    trade_size=Decimal(str(trade_size)),
                    fast_ema_period=fast,
                    slow_ema_period=slow,
                ),
            )
            engine.add_strategy(strategy_obj)
        elif strategy_id == "ema_cross":
            from nautilus_trader.model import Quantity
            from nautilus_trader.trading import EmaCrossConfig

            engine.add_builtin_strategy(
                "EmaCross",
                EmaCrossConfig(
                    instrument_id=instrument.id,
                    trade_size=Quantity.from_str(str(trade_size)),
                    fast_period=fast,
                    slow_period=slow,
                ),
            )
        else:
            raise ValueError(f"Unknown strategy {strategy_id!r}")

        hub.push(
            _event(
                "engine",
                f"Running: {strategy_id} · {data_id} · {len(bars) or len(quotes) or len(trades)} records",
                "ok",
            ),
        )
        engine.run()

        # ---------------------------------------------------------------- reports
        equity_curve: list[dict] = []
        account_rows: list[dict] = []
        positions_report: list[dict] = []
        fills_report: list[dict] = []
        orders_report: list[dict] = []
        try:
            account_df = engine.generate_account_report(venue=venue)
            account_rows = _df_records(account_df)
            equity_curve = _equity_from_account_report(account_df, start_balance)
        except Exception:
            equity_curve = [{"time": int(time.time()), "equity": round(start_balance, 2)}]
        try:
            positions_report = _df_records(engine.generate_positions_report())
        except Exception:
            pass
        try:
            fills_report = _df_records(engine.generate_order_fills_report())
        except Exception:
            pass
        try:
            orders_report = _df_records(engine.generate_orders_report())
        except Exception:
            pass

        closed = strategy_obj.closed_positions if strategy_obj is not None else []
        if not closed and positions_report:
            closed = []
            for row in positions_report:
                pnl = 0.0
                for k, v in row.items():
                    if "pnl" in str(k).lower() and "unreal" not in str(k).lower():
                        try:
                            pnl = float(v)
                        except Exception:
                            pass
                closed.append(
                    {
                        "id": str(row.get("position_id", uuid.uuid4().hex[:8])),
                        "symbol": str(row.get("instrument_id", instrument.id)).split(".")[0],
                        "side": "buy" if "BUY" in str(row.get("entry", "")).upper() else "sell",
                        "qty": float(row.get("quantity", 0) or 0),
                        "entry_price": float(row.get("avg_px_open", 0) or 0),
                        "mark_price": float(row.get("avg_px_close", 0) or 0),
                        "realized_pnl": pnl,
                        "opened_at": int(time.time()),
                        "closed_at": int(time.time()),
                        "strategy": strategy_id,
                    },
                )

        wins = sum(1 for c in closed if c.get("realized_pnl", 0) >= 0)
        win_rate = round(wins / len(closed) * 100, 1) if closed else 0.0
        fills = strategy_obj.fills if strategy_obj is not None else []
        orders = strategy_obj.orders if strategy_obj is not None else []
        bars_out = strategy_obj.bars if strategy_obj is not None else []

        # For quote-driven builtin runs, derive candles from quotes for charting
        if not bars_out and quotes:
            bars_out = _quotes_to_candles(quotes)

        fees_total = round(sum(abs(float(f.get("fee") or 0)) for f in (fills or [])), 6)
        equity_curve = _filter_curve_range(equity_curve, start_ts, end_ts) or equity_curve
        final_equity = equity_curve[-1]["equity"] if equity_curve else start_balance
        total_pnl = round(final_equity - start_balance, 2)
        ext = _extended_metrics(equity_curve, closed, start_balance, final_equity, bars_out, fees_total)

        elapsed = round(time.time() - started, 2)
        engine.dispose()

        hub.push(
            _event(
                "engine",
                f"Backtest finished in {elapsed}s — PnL {total_pnl:+,.2f}, {len(closed)} positions",
                "ok" if total_pnl >= 0 else "bad",
            ),
        )

        return {
            "status": "completed",
            "id": run_id,
            "elapsed_sec": elapsed,
            "params": {
                "strategy": strategy_id,
                "data_source": data_id,
                "n_bars": n_bars,
                "fast_ema_period": fast,
                "slow_ema_period": slow,
                "trade_size": trade_size,
                "starting_balance": start_balance,
                "account_type": account_type_raw,
                "start_ts": start_ts,
                "end_ts": end_ts,
            },
            "metrics": {
                "total_pnl": total_pnl,
                "final_equity": final_equity,
                "trades": len(closed),
                "win_rate": win_rate,
                "max_drawdown_pct": ext["max_drawdown_pct"],
                "fills": len(fills) or len(fills_report),
                "sharpe": ext["sharpe"],
                "sortino": ext["sortino"],
                "total_return_pct": ext["total_return_pct"],
                "annual_return_pct": ext["annual_return_pct"],
                "max_drawdown_abs": ext["max_drawdown_abs"],
                "longest_dd_days": ext["longest_dd_days"],
                "avg_dd_days": ext["avg_dd_days"],
                "total_dd_days": ext["total_dd_days"],
                "dd_count": int(ext["dd_count"]),
                "profit_factor": ext["profit_factor"],
                "profit_dd_ratio": ext["profit_dd_ratio"],
                "calmar": ext["calmar"],
                "romad": ext["romad"],
                "volatility_252": ext["volatility_252"],
                "var5": ext["var5"],
                "cvar5": ext["cvar5"],
                "edge_vs_bh_pct": ext["edge_vs_bh_pct"],
                "fees_total": ext["fees_total"],
                "gross_profit": ext["gross_profit"],
                "gross_loss": ext["gross_loss"],
            },
            "equity_curve": equity_curve,
            "fills": (fills[:40] if fills else _fills_from_report(fills_report)),
            "closed_positions": closed[:100],
            "orders": (orders[:20] if orders else _orders_from_report(orders_report)),
            "bars": bars_out,
            "reports": {
                "account": account_rows[:500],
                "positions": positions_report[:200],
                "fills": fills_report[:200],
                "orders": orders_report[:200],
            },
        }


def _equity_returns(curve: list[dict]) -> list[float]:
    rets: list[float] = []
    prev = 0.0
    for p in curve:
        eq = float(p.get("equity") or 0)
        if prev and eq:
            rets.append((eq - prev) / prev)
        prev = eq or prev
    return rets


def _sharpe(rets: list[float]) -> float:
    if len(rets) < 2:
        return 0.0
    mean = sum(rets) / len(rets)
    var = sum((r - mean) ** 2 for r in rets) / len(rets)
    std = var**0.5
    if std == 0:
        return 0.0
    return round((mean / std) * (252**0.5), 2)


def _sortino(rets: list[float]) -> float:
    if len(rets) < 2:
        return 0.0
    neg = [r for r in rets if r < 0]
    if not neg:
        return 0.0
    mean = sum(rets) / len(rets)
    var = sum((r - mean) ** 2 for r in neg) / len(neg)
    std = var**0.5
    if std == 0:
        return 0.0
    return round((mean / std) * (252**0.5), 2)


def _percentile(sorted_vals: list[float], pct: float) -> float:
    if not sorted_vals:
        return 0.0
    if len(sorted_vals) == 1:
        return sorted_vals[0]
    k = (len(sorted_vals) - 1) * pct
    f = int(k)
    c = min(f + 1, len(sorted_vals) - 1)
    d = k - f
    return sorted_vals[f] * (1 - d) + sorted_vals[c] * d


def _dd_periods(curve: list[dict]) -> list[tuple[float, float]]:
    if not curve:
        return []
    peak = float(curve[0].get("equity") or 0)
    start = None
    periods: list[tuple[float, float]] = []
    for p in curve:
        ts = float(p.get("time") or 0)
        val = float(p.get("equity") or 0)
        if val < peak:
            if start is None:
                start = ts
        else:
            if start is not None:
                periods.append((start, ts))
                start = None
            peak = val
    if start is not None and curve:
        periods.append((start, float(curve[-1].get("time") or 0)))
    return periods


def _dd_duration_days(periods: list[tuple[float, float]]) -> tuple[float, float, float]:
    if not periods:
        return 0.0, 0.0, 0.0
    durs = [(e - s) / 86400.0 for s, e in periods]
    return round(max(durs), 2), round(sum(durs) / len(durs), 2), round(sum(durs), 2)


def _extended_metrics(
    equity_curve: list[dict],
    closed: list[dict],
    start_balance: float,
    final_equity: float,
    bars_out: list[dict],
    fees_total: float,
) -> dict[str, float]:
    """Streamlit-parity risk/performance KPIs from equity + trades."""
    rets = _equity_returns(equity_curve)
    sorted_rets = sorted(rets)
    total_return = ((final_equity - start_balance) / start_balance) if start_balance else 0.0
    max_dd_pct = 0.0
    peak = start_balance
    max_dd_abs = 0.0
    for p in equity_curve:
        eq = float(p.get("equity") or 0)
        if eq > peak:
            peak = eq
        if peak > 0:
            dd = (peak - eq) / peak
            if dd > max_dd_pct:
                max_dd_pct = dd
            drop = peak - eq
            if drop > max_dd_abs:
                max_dd_abs = drop
    periods = _dd_periods(equity_curve)
    longest_dd, avg_dd, total_dd = _dd_duration_days(periods)

    if len(equity_curve) >= 2:
        span = float(equity_curve[-1].get("time") or 0) - float(equity_curve[0].get("time") or 0)
    elif bars_out:
        span = float(len(bars_out)) * 60.0
    else:
        span = 0.0
    if span > 0 and abs(total_return) < 10:
        annual_return = (1 + total_return) ** (31_536_000.0 / span) - 1
    else:
        annual_return = 0.0

    var5 = _percentile(sorted_rets, 0.05) if sorted_rets else 0.0
    cvar_rets = [r for r in sorted_rets if r <= var5] if sorted_rets else []
    cvar5 = (sum(cvar_rets) / len(cvar_rets)) if cvar_rets else 0.0

    vol = 0.0
    if len(rets) >= 2:
        mean = sum(rets) / len(rets)
        var = sum((r - mean) ** 2 for r in rets) / len(rets)
        vol = var**0.5 * (252**0.5)

    gains = sum(c.get("realized_pnl") or 0 for c in closed if (c.get("realized_pnl") or 0) > 0)
    losses = sum(c.get("realized_pnl") or 0 for c in closed if (c.get("realized_pnl") or 0) < 0)
    profit_factor = (gains / abs(losses)) if losses else (999.0 if gains > 0 else 0.0)
    profit_factor = round(min(profit_factor, 999.0), 2)

    calmar = (annual_return / max_dd_pct) if max_dd_pct > 0 else 0.0
    profit_dd = (total_return / max_dd_pct) if max_dd_pct > 0 else 0.0
    romad = profit_dd

    bh_edge = 0.0
    if bars_out and start_balance:
        first = float(bars_out[0].get("close") or 0)
        last = float(bars_out[-1].get("close") or 0)
        if first > 0:
            bh_final = (last / first) * start_balance
            if bh_final > 0:
                bh_edge = (final_equity / bh_final - 1) * 100.0

    return {
        "sharpe": _sharpe(rets),
        "sortino": _sortino(rets),
        "total_return_pct": round(total_return * 100, 2),
        "annual_return_pct": round(annual_return * 100, 2),
        "max_drawdown_pct": round(max_dd_pct * 100, 2),
        "max_drawdown_abs": round(max_dd_abs, 2),
        "longest_dd_days": longest_dd,
        "avg_dd_days": avg_dd,
        "total_dd_days": total_dd,
        "dd_count": float(len(periods)),
        "profit_factor": profit_factor,
        "profit_dd_ratio": round(profit_dd, 2),
        "calmar": round(calmar, 2),
        "romad": round(romad, 2),
        "volatility_252": round(vol, 4),
        "var5": round(var5 * 100, 4),
        "cvar5": round(cvar5 * 100, 4),
        "edge_vs_bh_pct": round(bh_edge, 2),
        "fees_total": round(fees_total, 6),
        "gross_profit": round(gains, 2),
        "gross_loss": round(losses, 2),
    }


def _filter_curve_range(
    curve: list[dict],
    start_ts: int | None,
    end_ts: int | None,
) -> list[dict]:
    if not curve or (not start_ts and not end_ts):
        return curve
    out = []
    for p in curve:
        t = int(p.get("time") or 0)
        if start_ts and t < start_ts:
            continue
        if end_ts and t > end_ts:
            continue
        out.append(p)
    return out or curve


def _parse_epoch(v: Any) -> int | None:
    if v in (None, "", 0, "0"):
        return None
    if isinstance(v, (int, float)):
        n = int(v)
        return n // 1000 if n > 1e12 else n
    try:
        n = int(float(str(v)))
        return n // 1000 if n > 1e12 else n
    except ValueError:
        pass
    try:
        import datetime as _dt

        s = str(v).replace("Z", "+00:00")
        dt = _dt.datetime.fromisoformat(s)
        if dt.tzinfo is None:
            dt = dt.replace(tzinfo=_dt.timezone.utc)
        return int(dt.timestamp())
    except Exception:
        return None


def _quotes_to_candles(quotes: list) -> list[dict]:
    out: list[dict] = []
    bucket: dict | None = None
    for q in quotes:
        ts = getattr(q, "ts_event", 0) or 0
        epoch = int(ts // 1_000_000_000) if ts > 1e12 else int(time.time())
        minute = epoch - (epoch % 60)
        mid = (_num(q.bid_price) + _num(q.ask_price)) / 2
        if bucket is None or bucket["time"] != minute:
            if bucket:
                out.append(bucket)
            bucket = {"time": minute, "open": round(mid, 6), "high": round(mid, 6), "low": round(mid, 6), "close": round(mid, 6), "volume": 0}
        else:
            bucket["high"] = max(bucket["high"], round(mid, 6))
            bucket["low"] = min(bucket["low"], round(mid, 6))
            bucket["close"] = round(mid, 6)
    if bucket:
        out.append(bucket)
    return out[-400:]


def _fills_from_report(rows: list[dict]) -> list[dict]:
    out = []
    for i, row in enumerate(rows[:40]):
        out.append(
            {
                "id": str(row.get("trade_id", row.get("client_order_id", i))),
                "symbol": str(row.get("instrument_id", "")).split(".")[0],
                "side": "buy" if "BUY" in str(row.get("order_side", row.get("side", "BUY"))).upper() else "sell",
                "qty": _safe_float(row.get("last_qty", row.get("quantity", 0))),
                "price": _safe_float(row.get("last_px", row.get("price", 0))),
                "fee": _safe_float(row.get("commission", 0)),
                "ts": int(time.time()),
                "strategy": str(row.get("strategy_id", "")),
            },
        )
    return out


def _orders_from_report(rows: list[dict]) -> list[dict]:
    out = []
    for i, row in enumerate(rows[:20]):
        out.append(
            {
                "id": str(row.get("client_order_id", i)),
                "symbol": str(row.get("instrument_id", "")).split(".")[0],
                "side": "buy" if "BUY" in str(row.get("order_side", row.get("side", "BUY"))).upper() else "sell",
                "type": str(row.get("order_type", "MARKET")),
                "qty": _safe_float(row.get("quantity", 0)),
                "price": _safe_float(row.get("price", 0)),
                "status": str(row.get("order_status", row.get("status", ""))),
                "strategy": str(row.get("strategy_id", "")),
                "created_at": int(time.time()),
            },
        )
    return out


def _safe_float(v: Any) -> float:
    try:
        return round(float(v), 8)
    except Exception:
        return 0.0


runner = BacktestRunner()
