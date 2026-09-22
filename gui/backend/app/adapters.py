"""Static registry of venue adapters with credential detection (names only, never values)."""

from __future__ import annotations

import importlib.util
import os
from typing import Any

# credential_env: env var names the adapter expects (values are never read or returned)
_ADAPTERS: list[dict[str, Any]] = [
    {
        "id": "BINANCE",
        "name": "Binance",
        "type": "crypto_cex",
        "data": True,
        "exec": True,
        "environments": ["TESTNET", "DEMO", "LIVE"],
        "credential_env": ["BINANCE_API_KEY", "BINANCE_API_SECRET"],
        "module": "nautilus_trader.adapters.binance",
        "live_ready": True,
        "notes": "Public market data needs no keys; sandbox execution simulated locally.",
    },
    {
        "id": "BYBIT",
        "name": "Bybit",
        "type": "crypto_cex",
        "data": True,
        "exec": True,
        "environments": ["TESTNET", "LIVE"],
        "credential_env": ["BYBIT_API_KEY", "BYBIT_API_SECRET"],
        "module": "nautilus_trader.adapters.bybit",
        "live_ready": False,
    },
    {
        "id": "OKX",
        "name": "OKX",
        "type": "crypto_cex",
        "data": True,
        "exec": True,
        "environments": ["DEMO", "LIVE"],
        "credential_env": ["OKX_API_KEY", "OKX_API_SECRET", "OKX_API_PASSPHRASE"],
        "module": "nautilus_trader.adapters.okx",
        "live_ready": False,
    },
    {
        "id": "KRAKEN",
        "name": "Kraken",
        "type": "crypto_cex",
        "data": True,
        "exec": True,
        "environments": ["LIVE"],
        "credential_env": ["KRAKEN_API_KEY", "KRAKEN_API_SECRET"],
        "module": "nautilus_trader.adapters.kraken",
        "live_ready": False,
    },
    {
        "id": "COINBASE",
        "name": "Coinbase",
        "type": "crypto_cex",
        "data": True,
        "exec": True,
        "environments": ["LIVE"],
        "credential_env": ["COINBASE_API_KEY", "COINBASE_API_SECRET"],
        "module": "nautilus_trader.adapters.coinbase",
        "live_ready": False,
    },
    {
        "id": "BITMEX",
        "name": "BitMEX",
        "type": "crypto_cex",
        "data": True,
        "exec": True,
        "environments": ["TESTNET", "LIVE"],
        "credential_env": ["BITMEX_API_KEY", "BITMEX_API_SECRET"],
        "module": "nautilus_trader.adapters.bitmex",
        "live_ready": False,
    },
    {
        "id": "DERIBIT",
        "name": "Deribit",
        "type": "crypto_cex",
        "data": True,
        "exec": True,
        "environments": ["TESTNET", "LIVE"],
        "credential_env": ["DERIBIT_API_KEY", "DERIBIT_API_SECRET"],
        "module": "nautilus_trader.adapters.deribit",
        "live_ready": False,
    },
    {
        "id": "DYDX",
        "name": "dYdX",
        "type": "crypto_dex",
        "data": True,
        "exec": True,
        "environments": ["TESTNET", "MAINNET"],
        "credential_env": ["DYDX_API_KEY", "DYDX_API_SECRET", "DYDX_API_PASSPHRASE"],
        "module": "nautilus_trader.adapters.dydx",
        "live_ready": False,
    },
    {
        "id": "HYPERLIQUID",
        "name": "Hyperliquid",
        "type": "crypto_dex",
        "data": True,
        "exec": True,
        "environments": ["TESTNET", "LIVE"],
        "credential_env": ["HYPERLIQUID_API_KEY", "HYPERLIQUID_API_SECRET"],
        "module": "nautilus_trader.adapters.hyperliquid",
        "live_ready": False,
    },
    {
        "id": "DERIVE",
        "name": "Derive",
        "type": "crypto_dex",
        "data": True,
        "exec": True,
        "environments": ["TESTNET", "LIVE"],
        "credential_env": ["DERIVE_API_KEY", "DERIVE_API_SECRET"],
        "module": "nautilus_trader.adapters.derive",
        "live_ready": False,
    },
    {
        "id": "LIGHTER",
        "name": "Lighter",
        "type": "crypto_dex",
        "data": True,
        "exec": True,
        "environments": ["LIVE"],
        "credential_env": ["LIGHTER_API_KEY", "LIGHTER_API_SECRET"],
        "module": "nautilus_trader.adapters.lighter",
        "live_ready": False,
    },
    {
        "id": "POLYMARKET",
        "name": "Polymarket",
        "type": "prediction_dex",
        "data": True,
        "exec": True,
        "environments": ["LIVE"],
        "credential_env": ["POLYMARKET_API_KEY", "POLYMARKET_API_SECRET"],
        "module": "nautilus_trader.adapters.polymarket",
        "live_ready": False,
    },
    {
        "id": "BETFAIR",
        "name": "Betfair",
        "type": "betting",
        "data": True,
        "exec": True,
        "environments": ["SANDBOX", "LIVE"],
        "credential_env": ["BETFAIR_APP_KEY", "BETFAIR_CERT_FILE", "BETFAIR_KEY_FILE"],
        "module": "nautilus_trader.adapters.betfair",
        "live_ready": False,
    },
    {
        "id": "INTERACTIVE_BROKERS",
        "name": "Interactive Brokers",
        "type": "traditional",
        "data": True,
        "exec": True,
        "environments": ["TESTNET", "LIVE"],
        "credential_env": ["TWS_HOST", "TWS_PORT"],
        "module": "nautilus_trader.adapters.interactive_brokers",
        "live_ready": False,
        "notes": "Requires a running TWS or IB Gateway.",
    },
    {
        "id": "DATABENTO",
        "name": "Databento",
        "type": "data_provider",
        "data": True,
        "exec": False,
        "environments": ["LIVE"],
        "credential_env": ["DATABENTO_API_KEY"],
        "module": "nautilus_trader.adapters.databento",
        "live_ready": False,
    },
    {
        "id": "TARDIS",
        "name": "Tardis.dev",
        "type": "data_provider",
        "data": True,
        "exec": False,
        "environments": ["LIVE"],
        "credential_env": ["TARDIS_API_KEY"],
        "module": "nautilus_trader.adapters.tardis",
        "live_ready": False,
    },
    {
        "id": "BLOCKCHAIN",
        "name": "Blockchain data",
        "type": "data_provider",
        "data": True,
        "exec": False,
        "environments": ["LIVE"],
        "credential_env": [],
        "module": "nautilus_trader.adapters.blockchain",
        "live_ready": False,
    },
    {
        "id": "ARCHITECT_AX",
        "name": "AX Exchange",
        "type": "crypto_perps",
        "data": True,
        "exec": True,
        "environments": ["TESTNET", "LIVE"],
        "credential_env": ["AX_API_KEY", "AX_API_SECRET"],
        "module": "nautilus_trader.adapters.architect_ax",
        "live_ready": False,
    },
    {
        "id": "SANDBOX",
        "name": "Sandbox (local matching)",
        "type": "simulated",
        "data": False,
        "exec": True,
        "environments": ["SANDBOX"],
        "credential_env": [],
        "module": "nautilus_trader.adapters.sandbox",
        "live_ready": True,
        "notes": "Local fill simulation — used by the GUI sandbox session.",
    },
    {
        "id": "RITHMIC",
        "name": "Rithmic",
        "type": "traditional",
        "data": True,
        "exec": True,
        "environments": ["LIVE"],
        "credential_env": ["RITHMIC_USER", "RITHMIC_PASSWORD"],
        "module": None,
        "live_ready": False,
        "supported": False,
        "notes": "No built-in adapter in NautilusTrader — requires a custom DataClient/ExecutionClient integration.",
    },
]


def list_adapters() -> list[dict[str, Any]]:
    out: list[dict[str, Any]] = []
    for a in _ADAPTERS:
        module = a.get("module")
        installed = False
        if module:
            try:
                installed = importlib.util.find_spec(module) is not None
            except Exception:
                installed = False
        creds = a.get("credential_env") or []
        creds_set = [c for c in creds if os.environ.get(c)]
        supported = a.get("supported", True)
        if not supported:
            status = "unsupported"
        elif not installed:
            status = "not_installed"
        elif a.get("live_ready"):
            status = "ready"
        elif creds and len(creds_set) == len(creds):
            status = "credentials_set"
        elif creds:
            status = "missing_credentials"
        else:
            status = "installed"
        out.append(
            {
                "id": a["id"],
                "name": a["name"],
                "type": a["type"],
                "data": a["data"],
                "exec": a["exec"],
                "environments": a.get("environments", []),
                "installed": installed,
                "live_ready": bool(a.get("live_ready")),
                "supported": supported,
                "status": status,
                "credentials_configured": len(creds_set),
                "credentials_required": len(creds),
                "credential_env_names": creds,
                "notes": a.get("notes"),
            },
        )
    return out
