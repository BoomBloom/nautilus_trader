import type {
  AdapterInfo,
  BacktestCatalog,
  BacktestHistoryItem,
  BacktestResult,
  BacktestStatus,
  CatalogResponse,
  NodeStatus,
  Order,
  OrderTicketPayload,
} from "./types";

const GUI_TOKEN = process.env.NEXT_PUBLIC_GUI_TOKEN || "";

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(path, {
    headers: {
      "Content-Type": "application/json",
      ...(GUI_TOKEN ? { "X-API-Token": GUI_TOKEN } : {}),
      ...(init?.headers || {}),
    },
    ...init,
  });
  if (!res.ok) {
    let detail = `HTTP ${res.status}`;
    try {
      const body = await res.json();
      if (body?.detail) detail = String(body.detail);
    } catch {
      /* ignore */
    }
    throw new Error(detail);
  }
  return (await res.json()) as T;
}

// ------------------------------------------------------------------------- health / node

export const getHealth = () => request<{ status: string }>("/api/health");

export const getNodeStatus = () => request<NodeStatus>("/api/node");

export const startSandbox = (config: Record<string, unknown> = {}) =>
  request<NodeStatus>("/api/node/sandbox/start", {
    method: "POST",
    body: JSON.stringify(config),
  });

export const stopSandbox = () =>
  request<NodeStatus>("/api/node/sandbox/stop", { method: "POST", body: "{}" });

// ------------------------------------------------------------------------- snapshot / data

export const getSnapshot = <T = unknown>() => request<T>("/api/snapshot");

export const getInstruments = () => request<unknown[]>("/api/instruments");

export const getAccount = () => request<Record<string, unknown>>("/api/account");

export const getStrategies = () =>
  request<{ registered: unknown[]; available: unknown[]; mode: string }>("/api/strategies");

// ------------------------------------------------------------------------- orders

export const submitOrder = (payload: OrderTicketPayload) =>
  request<{ status: string; command_id?: string }>("/api/orders", {
    method: "POST",
    body: JSON.stringify(payload),
  });

export const cancelOrder = (orderId: string) =>
  request<{ status: string; command_id?: string }>(
    `/api/orders/${encodeURIComponent(orderId)}/cancel`,
    {
      method: "POST",
      body: "{}",
    },
  );

export const cancelAllOrders = (instrumentId?: string) =>
  request<{ status: string; command_id?: string }>("/api/orders/cancel-all", {
    method: "POST",
    body: JSON.stringify(instrumentId ? { instrument_id: instrumentId } : {}),
  });

export const listOrders = (limit = 50, offset = 0) =>
  request<{ items: Order[]; total: number; limit: number; offset: number }>(
    `/api/orders?limit=${limit}&offset=${offset}`,
  );

export const modifyOrder = (
  orderId: string,
  body: { qty?: string; price?: string },
) =>
  request<{ status: string; command_id?: string }>(
    `/api/orders/${encodeURIComponent(orderId)}/modify`,
    {
      method: "POST",
      body: JSON.stringify(body),
    },
  );

export const closePosition = (instrumentId?: string) =>
  request<{ status: string }>("/api/positions/close", {
    method: "POST",
    body: JSON.stringify(instrumentId ? { instrument_id: instrumentId } : {}),
  });

export const setRiskState = (state: "ACTIVE" | "REDUCING" | "HALTED") =>
  request<{ status: string; risk_state: string }>("/api/risk/state", {
    method: "POST",
    body: JSON.stringify({ state }),
  });

// ------------------------------------------------------------------------- backtest

export const getBacktestCatalog = () => request<BacktestCatalog>("/api/backtest/catalog");

export const getBacktestStatus = () => request<BacktestStatus>("/api/backtest/status");

export const getBacktestHistory = (limit = 20) =>
  request<BacktestHistoryItem[]>(`/api/backtest/history?limit=${limit}`);

export const runBacktest = (params: Record<string, unknown>) =>
  request<BacktestResult>("/api/backtest/run", {
    method: "POST",
    body: JSON.stringify(params),
  });

// ------------------------------------------------------------------------- adapters / catalog

export const getAdapters = () => request<AdapterInfo[]>("/api/adapters");

export const getCatalog = () => request<CatalogResponse>("/api/catalog");
