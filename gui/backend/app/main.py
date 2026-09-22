import asyncio
import contextlib
import os
from typing import Any

from fastapi import Body, FastAPI, HTTPException, WebSocket, WebSocketDisconnect
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse

from .adapters import list_adapters
from .backtest_runner import backtest_catalog, runner
from .catalog import list_catalog
from .hub import hub
from .session import session

app = FastAPI(title="Nautilus GUI Backend", version="0.2.0")

# Auth: when GUI_TOKEN is set, all mutating (non-GET) routes and the WebSocket
# require it. Unset = local dev mode (auth off) — never expose port 8000 then.
GUI_TOKEN = os.environ.get("GUI_TOKEN", "")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:3000", "http://127.0.0.1:3000"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.middleware("http")
async def require_token(request, call_next):  # type: ignore[no-untyped-def]
    if GUI_TOKEN and request.method not in ("GET", "HEAD", "OPTIONS"):
        if request.headers.get("X-API-Token") != GUI_TOKEN:
            return JSONResponse(
                status_code=401,
                content={"detail": "Missing or invalid X-API-Token"},
            )
    return await call_next(request)

clients: set[WebSocket] = set()


@app.on_event("startup")
async def startup() -> None:
    asyncio.create_task(replay_loop())
    asyncio.create_task(hub_loop())


@app.on_event("shutdown")
async def shutdown() -> None:
    if session.mode == "live":
        with contextlib.suppress(Exception):
            await session.stop_sandbox()


async def broadcast(payload: dict[str, Any]) -> None:
    dead = []
    for ws in list(clients):
        try:
            await ws.send_json(payload)
        except Exception:
            dead.append(ws)
    for ws in dead:
        clients.discard(ws)


async def hub_loop() -> None:
    """Drain engine/agent events and broadcast to WebSocket clients."""
    while True:
        for msg in hub.drain():
            await broadcast(msg)
        await asyncio.sleep(0.15)


async def replay_loop() -> None:
    while True:
        try:
            if session.mode == "replay":
                events = session.replay.step()
                for ev in events:
                    await broadcast(ev)
        except Exception:
            with contextlib.suppress(Exception):
                await broadcast(
                    {"type": "event", "event": {"type": "error", "text": "Replay error", "tone": "bad", "ts": 0, "id": "e"}},
                )
        await asyncio.sleep(0.5)


# --------------------------------------------------------------------------- health / node


@app.get("/api/health")
def health() -> dict:
    return {"status": "ok"}


@app.get("/api/node")
def node_status() -> dict:
    return session.status()


@app.post("/api/node/sandbox/start")
async def node_sandbox_start(config: dict | None = Body(default=None)) -> dict:
    try:
        return await session.start_sandbox(config or {})
    except RuntimeError as exc:
        raise HTTPException(status_code=409, detail=str(exc)) from exc
    except Exception as exc:
        raise HTTPException(status_code=500, detail=str(exc)) from exc


@app.post("/api/node/sandbox/stop")
async def node_sandbox_stop() -> dict:
    try:
        return await session.stop_sandbox()
    except Exception as exc:
        raise HTTPException(status_code=500, detail=str(exc)) from exc


# --------------------------------------------------------------------------- snapshots (legacy + real)


@app.get("/api/snapshot")
def snapshot() -> dict:
    return session.snapshot()


@app.get("/api/summary")
def summary() -> dict:
    return session.snapshot().get("summary", {})


@app.get("/api/positions")
def positions() -> list:
    return session.snapshot().get("positions", [])


@app.get("/api/fills")
def fills() -> list:
    return session.snapshot().get("fills", [])


@app.get("/api/events")
def events() -> list:
    return session.snapshot().get("events", [])


@app.get("/api/strategies")
def strategies() -> dict:
    snap = session.snapshot()
    available = [
        {"id": s["id"], "name": s["name"], "description": s["description"]}
        for s in backtest_catalog()["strategies"]
    ]
    return {
        "registered": snap.get("strategies", []),
        "available": available,
        "mode": session.mode,
    }


@app.get("/api/instruments")
def instruments() -> list:
    return session.snapshot().get("instruments", [])


@app.get("/api/account")
def account() -> dict:
    return session.snapshot().get("account", {"balances": []})


# --------------------------------------------------------------------------- orders (live node only)


@app.get("/api/orders")
def orders_list(limit: int = 50, offset: int = 0) -> dict:
    all_orders = session.snapshot().get("orders", [])
    limit = max(1, min(int(limit), 500))
    offset = max(0, int(offset))
    page = all_orders[offset : offset + limit]
    return {"items": page, "total": len(all_orders), "limit": limit, "offset": offset}


@app.post("/api/orders")
def orders_submit(body: dict = Body(...)) -> dict:
    try:
        return session.submit_order(body)
    except RuntimeError as exc:
        raise HTTPException(status_code=409, detail=str(exc)) from exc
    except KeyError as exc:
        raise HTTPException(status_code=422, detail=f"Missing field {exc}") from exc
    except ValueError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc
    except Exception as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc


@app.post("/api/orders/cancel-all")
def orders_cancel_all(body: dict | None = Body(default=None)) -> dict:
    try:
        iid = (body or {}).get("instrument_id")
        return session.cancel_all_orders(str(iid) if iid else None)
    except RuntimeError as exc:
        raise HTTPException(status_code=409, detail=str(exc)) from exc


@app.post("/api/orders/{order_id}/cancel")
def orders_cancel(order_id: str) -> dict:
    try:
        return session.cancel_order(order_id)
    except RuntimeError as exc:
        raise HTTPException(status_code=409, detail=str(exc)) from exc


@app.post("/api/orders/{order_id}/modify")
def orders_modify(order_id: str, body: dict = Body(...)) -> dict:
    try:
        return session.modify_order(order_id, body)
    except RuntimeError as exc:
        raise HTTPException(status_code=409, detail=str(exc)) from exc
    except Exception as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc


@app.post("/api/positions/close")
def positions_close(body: dict = Body(default=None)) -> dict:
    try:
        if body and body.get("instrument_id"):
            return session.close_position(body["instrument_id"])
        return session.close_all_positions()
    except RuntimeError as exc:
        raise HTTPException(status_code=409, detail=str(exc)) from exc


@app.post("/api/risk/state")
def risk_state(body: dict = Body(default=None)) -> dict:
    try:
        return session.set_risk_state((body or {}).get("state", "ACTIVE"))
    except RuntimeError as exc:
        raise HTTPException(status_code=409, detail=str(exc)) from exc
    except ValueError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc


# --------------------------------------------------------------------------- backtest


@app.get("/api/backtest/catalog")
def bt_catalog() -> dict:
    return backtest_catalog()


@app.get("/api/backtest/status")
def backtest_status() -> dict:
    return runner.status()


@app.get("/api/backtest/history")
def backtest_history(limit: int = 20) -> list:
    return runner.history(limit)


@app.post("/api/backtest/run")
async def backtest_run(params: dict | None = Body(default=None)) -> dict:
    if runner.running:
        raise HTTPException(status_code=409, detail="A backtest is already running")
    prev_mode = session.mode
    if prev_mode == "replay":
        session.set_mode("backtest")
    try:
        result = await asyncio.to_thread(runner.run, params or {})
    except RuntimeError as exc:
        raise HTTPException(status_code=409, detail=str(exc)) from exc
    except ValueError as exc:
        if session.mode == "backtest":
            session.set_mode("replay")
        raise HTTPException(status_code=422, detail=str(exc)) from exc
    except Exception as exc:
        if session.mode == "backtest":
            session.set_mode("replay")
        raise HTTPException(status_code=500, detail=str(exc)) from exc
    if session.mode == "backtest":
        session.set_mode("replay")
    return result


# --------------------------------------------------------------------------- adapters / data catalog


@app.get("/api/adapters")
def adapters() -> list:
    return list_adapters()


@app.get("/api/catalog")
def catalog() -> dict:
    return list_catalog()


# --------------------------------------------------------------------------- websocket


@app.websocket("/ws/stream")
async def ws_stream(ws: WebSocket) -> None:
    if GUI_TOKEN and ws.query_params.get("token") != GUI_TOKEN:
        await ws.close(code=4401, reason="Missing or invalid token")
        return
    await ws.accept()
    clients.add(ws)
    try:
        await ws.send_json(session.snapshot())
        await ws.send_json({"type": "node", "node": session.status()})
        await ws.send_json({"type": "mode", "mode": session.mode})
        while True:
            await ws.receive_text()
    except WebSocketDisconnect:
        pass
    finally:
        clients.discard(ws)
