"""Session manager: mode switching, sandbox LiveNode lifecycle, snapshot routing."""

from __future__ import annotations

import asyncio
import threading
from typing import Any

from .engine import TradingEngine
from .hub import hub
from .serializers import feed_event
from .state import commands, live_store

DEFAULT_INSTRUMENT = "BTCUSDT.BINANCE"
DEFAULT_TRADER_ID = "GUI-001"
SANDBOX_ACCOUNT_ID = "BINANCE-SANDBOX-001"


class SessionManager:
    """Owns the replay engine and the optional sandbox LiveNode."""

    def __init__(self) -> None:
        self.replay = TradingEngine()
        self.mode: str = "replay"  # replay | backtest | live
        self._lock = threading.Lock()
        self._node: Any = None
        self._node_task: asyncio.Task | None = None
        self._starting = False

    # ------------------------------------------------------------------ mode

    def set_mode(self, mode: str) -> None:
        with self._lock:
            self.mode = mode
        hub.push({"type": "mode", "mode": mode})
        live_store.set_node_status(mode=mode)

    def status(self) -> dict[str, Any]:
        st = live_store.get_node_status()
        st["mode"] = self.mode
        st["backtest_running"] = self.mode == "backtest"
        return st

    # ------------------------------------------------------------------ snapshots

    def snapshot(self) -> dict[str, Any]:
        if self.mode == "live":
            snap = live_store.get_snapshot()
            if snap is not None:
                return snap
        snap = self.replay.snapshot()
        snap["mode"] = self.mode
        if self.mode == "backtest":
            snap["summary"] = dict(snap["summary"], ticks=snap["summary"].get("ticks", 0))
        return snap

    # ------------------------------------------------------------------ sandbox node

    async def start_sandbox(self, config: dict[str, Any] | None = None) -> dict[str, Any]:
        if self._starting or self._node is not None:
            raise RuntimeError("Sandbox node already running")
        cfg = config or {}
        adapter = str(cfg.get("adapter") or "BINANCE").upper()
        instrument_id = str(cfg.get("instrument_id") or DEFAULT_INSTRUMENT)
        trader_id = str(cfg.get("trader_id") or DEFAULT_TRADER_ID)
        attach_ema = bool(cfg.get("attach_ema_cross", False))
        reconciliation = bool(cfg.get("reconciliation", False))
        ema_fast = int(cfg.get("ema_fast", 10))
        ema_slow = int(cfg.get("ema_slow", 50))
        trade_size = str(cfg.get("trade_size", "0.001"))
        starting_balance = str(cfg.get("starting_balance", "100000"))
        binance_env = str(cfg.get("binance_env", "LIVE")).upper()
        subscribe_instruments = cfg.get("instrument_ids") or [instrument_id]

        self._starting = True
        self.set_mode("live")
        commands.clear()
        live_store.clear_snapshot()
        hub.push(feed_event("node", f"Starting sandbox LiveNode via {adapter} (no real funds)…", "ok"))

        try:
            # PyLiveNode is unsendable — it must be built and used on this thread only.
            node = self._build_node(
                trader_id,
                instrument_id,
                starting_balance,
                binance_env,
                subscribe_instruments,
                attach_ema,
                ema_fast,
                ema_slow,
                trade_size,
                adapter=adapter,
                reconciliation=reconciliation,
            )
        except Exception as exc:
            self._starting = False
            self.set_mode("replay")
            live_store.set_node_status(running=False, state="STOPPED", error=str(exc))
            hub.push(feed_event("node", f"Failed to build sandbox node: {exc}", "bad"))
            raise

        handle = node.handle()
        live_store.set_node_status(
            running=True,
            state=str(handle.state),
            trader_id=trader_id,
            instrument_id=instrument_id,
            error=None,
            risk_state="ACTIVE",
        )
        hub.push(feed_event("node", f"LiveNode {trader_id} starting ({instrument_id} · {adapter})", "ok"))
        hub.push({"type": "node", "node": live_store.get_node_status()})

        self._node = node
        self._node_task = asyncio.create_task(self._run_node(node))
        self._starting = False
        return self.status()

    async def _run_node(self, node: Any) -> None:
        try:
            await node.run_async()
            hub.push(feed_event("node", "LiveNode run loop finished", "info"))
        except asyncio.CancelledError:
            raise
        except Exception as exc:
            live_store.set_node_status(error=str(exc), running=False, state="FAULTED")
            hub.push(feed_event("node", f"LiveNode error: {exc}", "bad"))
        finally:
            self._node = None
            live_store.set_node_status(running=False, state="STOPPED")
            hub.push({"type": "node", "node": live_store.get_node_status()})
            if self.mode == "live":
                self.set_mode("replay")

    async def stop_sandbox(self) -> dict[str, Any]:
        node = self._node
        if node is None:
            self.set_mode("replay")
            return self.status()
        hub.push(feed_event("node", "Stopping sandbox LiveNode…", "warn"))
        handle = node.handle()
        try:
            handle.stop()
        except Exception as exc:
            hub.push(feed_event("node", f"Stop signal failed: {exc}", "bad"))
        if self._node_task is not None:
            try:
                await asyncio.wait_for(self._node_task, timeout=15.0)
            except (asyncio.TimeoutError, Exception):
                self._node_task.cancel()
            self._node_task = None
        try:
            node.dispose()
        except Exception:
            pass
        self._node = None
        live_store.set_node_status(running=False, state="STOPPED")
        hub.push(feed_event("node", "LiveNode stopped — back to replay mode", "info"))
        self.set_mode("replay")
        return self.status()

    def _build_node(
        self,
        trader_id: str,
        instrument_id: str,
        starting_balance: str,
        binance_env: str,
        instrument_ids: list[str],
        attach_ema: bool,
        ema_fast: int,
        ema_slow: int,
        trade_size: str,
        adapter: str = "BINANCE",
        reconciliation: bool = False,
    ) -> Any:
        from nautilus_trader.adapters.sandbox import SandboxExecutionClientConfig
        from nautilus_trader.adapters.sandbox import SandboxExecutionClientFactory
        from nautilus_trader.common import Environment
        from nautilus_trader.config import LiveRiskEngineConfig
        from nautilus_trader.live import LiveNode
        from nautilus_trader.model import (
            AccountId,
            InstrumentId,
            Money,
            Quantity,
            TraderId,
            Venue,
        )

        from .gui_agent import GuiAgent, GuiAgentConfig

        adapter_u = (adapter or "BINANCE").upper()
        data_client = self._resolve_data_client(adapter_u, binance_env)
        venue_name = instrument_id.split(".")[-1] if "." in instrument_id else adapter_u
        venue = Venue.from_str(venue_name)

        builder = (
            LiveNode.builder(trader_id.upper(), TraderId.from_str(trader_id), Environment.SANDBOX)
            .with_reconciliation(reconciliation=reconciliation)
            .with_risk_engine_config(LiveRiskEngineConfig(bypass=False))
        )
        if data_client is not None:
            factory, data_config = data_client
            builder = builder.add_data_client(None, factory(), data_config)
        builder = builder.add_simulated_exec_client(
            venue_name,
            SandboxExecutionClientFactory(),
            SandboxExecutionClientConfig(
                venue=venue,
                starting_balances=[Money.from_str(f"{starting_balance} USDT")],
                account_id=AccountId.from_str(f"{venue_name}-SANDBOX-001"),
            ),
        )
        node = builder.build()

        node.add_strategy(
            GuiAgent(
                GuiAgentConfig(
                    instrument_ids=list(instrument_ids),
                    snapshot_interval_ms=500,
                    command_interval_ms=250,
                ),
            ),
        )

        if attach_ema:
            from nautilus_trader.trading import EmaCrossConfig

            node.add_builtin_strategy(
                "EmaCross",
                EmaCrossConfig(
                    instrument_id=InstrumentId.from_str(instrument_id),
                    trade_size=Quantity.from_str(trade_size),
                    fast_period=ema_fast,
                    slow_period=ema_slow,
                ),
            )
            hub.push(
                feed_event(
                    "strategy",
                    f"Attached builtin EmaCross {ema_fast}/{ema_slow} on {instrument_id}",
                    "ok",
                ),
            )

        return node

    def _resolve_data_client(self, adapter: str, binance_env: str) -> tuple[Any, Any] | None:
        """Import the adapter DataClient factory + config dynamically."""
        from .adapters import _ADAPTERS

        meta = next((a for a in _ADAPTERS if a["id"] == adapter), None)
        module_path = meta.get("module") if meta else None
        if not module_path:
            raise ValueError(
                f"Adapter {adapter!r} has no built-in data client — pick another adapter",
            )
        if not meta.get("data", True):
            raise ValueError(f"Adapter {adapter!r} does not provide market data")

        import importlib

        try:
            mod = importlib.import_module(module_path)
        except Exception as exc:
            raise ValueError(f"Failed to import adapter module {module_path}: {exc}") from exc

        factory_cls = next(
            (getattr(mod, n) for n in dir(mod) if n.endswith("DataClientFactory") and not n.startswith("_")),
            None,
        )
        config_cls = next(
            (getattr(mod, n) for n in dir(mod) if n.endswith("DataClientConfig") and not n.startswith("_")),
            None,
        )
        if factory_cls is None or config_cls is None:
            raise ValueError(f"Adapter {adapter!r} module is missing DataClient factory/config")

        if adapter == "BINANCE":
            from nautilus_trader.adapters.binance import (
                BinanceDataClientConfig,
                BinanceEnvironment,
                BinanceProductType,
                BinanceSpotMarketDataMode,
            )

            env_map = {
                "LIVE": BinanceEnvironment.LIVE,
                "TESTNET": BinanceEnvironment.TESTNET,
                "DEMO": BinanceEnvironment.DEMO,
            }
            data_config: Any = BinanceDataClientConfig(
                product_type=BinanceProductType.SPOT,
                environment=env_map.get(binance_env.upper(), BinanceEnvironment.LIVE),
                spot_market_data_mode=BinanceSpotMarketDataMode.Json,
            )
        else:
            try:
                data_config = config_cls()
            except Exception as exc:
                raise ValueError(
                    f"Adapter {adapter!r} data config requires credentials/options: {exc}",
                ) from exc
        return factory_cls, data_config

    # ------------------------------------------------------------------ commands (REST → agent)

    def submit_order(self, body: dict[str, Any]) -> dict[str, Any]:
        self._require_live()
        order_type = str(body.get("type", "MARKET")).upper()
        if order_type in ("STOP_MARKET", "STOP_LIMIT") and body.get("trigger_price") in (None, ""):
            raise ValueError(f"{order_type} orders require a trigger_price")
        command_id = __import__("uuid").uuid4().hex[:12]
        commands.push(
            {
                "action": "submit",
                "command_id": command_id,
                "instrument_id": body["instrument_id"],
                "side": body.get("side", "buy"),
                "type": order_type,
                "qty": str(body["qty"]),
                "price": str(body["price"]) if body.get("price") not in (None, "") else None,
                "trigger_price": str(body["trigger_price"]) if body.get("trigger_price") not in (None, "") else None,
                "tif": body.get("tif", "GTC"),
                "expires_at": body.get("expires_at"),
            },
        )
        return {"status": "queued", "command_id": command_id}

    def cancel_order(self, order_id: str) -> dict[str, Any]:
        self._require_live()
        command_id = __import__("uuid").uuid4().hex[:12]
        commands.push({"action": "cancel", "command_id": command_id, "order_id": order_id})
        return {"status": "queued", "command_id": command_id}

    def cancel_all_orders(self, instrument_id: str | None = None) -> dict[str, Any]:
        self._require_live()
        command_id = __import__("uuid").uuid4().hex[:12]
        cmd: dict[str, Any] = {"action": "cancel_all", "command_id": command_id}
        if instrument_id:
            cmd["instrument_id"] = instrument_id
        commands.push(cmd)
        return {"status": "queued", "command_id": command_id}

    def modify_order(self, order_id: str, body: dict[str, Any]) -> dict[str, Any]:
        self._require_live()
        command_id = __import__("uuid").uuid4().hex[:12]
        commands.push(
            {
                "action": "modify",
                "command_id": command_id,
                "order_id": order_id,
                "qty": str(body["qty"]) if body.get("qty") else None,
                "price": str(body["price"]) if body.get("price") else None,
            },
        )
        return {"status": "queued", "command_id": command_id}

    def close_position(self, instrument_id: str) -> dict[str, Any]:
        self._require_live()
        commands.push({"action": "close_position", "instrument_id": instrument_id})
        return {"status": "queued"}

    def close_all_positions(self) -> dict[str, Any]:
        self._require_live()
        commands.push({"action": "close_all"})
        return {"status": "queued"}

    def set_risk_state(self, state: str) -> dict[str, Any]:
        """Set the GUI trading kill-switch state: ACTIVE | REDUCING | HALTED."""
        state_u = str(state).upper()
        if state_u not in ("ACTIVE", "REDUCING", "HALTED"):
            raise ValueError(f"Invalid risk state {state!r} — use ACTIVE, REDUCING, or HALTED")
        self._require_live()
        commands.push({"action": "risk_state", "state": state_u})
        live_store.set_node_status(risk_state=state_u)
        tone = "bad" if state_u == "HALTED" else ("warn" if state_u == "REDUCING" else "ok")
        hub.push(feed_event("risk", f"Risk/trading state → {state_u}", tone))
        hub.push({"type": "node", "node": live_store.get_node_status()})
        return {"status": "queued", "risk_state": state_u}

    def _require_live(self) -> None:
        if self.mode != "live" or self._node is None:
            raise RuntimeError("No live node running — start the sandbox session first")


session = SessionManager()
