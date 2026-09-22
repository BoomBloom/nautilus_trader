export type Candle = {
  time: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
};

export type EquityPoint = { time: number; equity: number };

export type Position = {
  id: string;
  symbol: string;
  side: "long" | "short";
  qty: number;
  entry_price: number;
  mark_price: number;
  unrealized_pnl: number;
  opened_at: number;
  strategy: string;
  instrument_id?: string;
};

export type Order = {
  id: string;
  symbol: string;
  side: string;
  type: string;
  qty: number;
  price: number;
  status: string;
  strategy: string;
  created_at: number;
  filled_qty?: number;
  instrument_id?: string;
  fee?: number;
  avg_px?: number;
  tif?: string;
  expires_at?: number | null;
};

export type Fill = {
  id: string;
  symbol: string;
  side: string;
  qty: number;
  price: number;
  fee: number;
  ts: number;
  strategy: string;
};

export type FeedEvent = {
  id: string;
  ts: number;
  type: string;
  text: string;
  tone: "info" | "ok" | "bad" | "warn";
};

export type Strategy = {
  name: string;
  symbol: string;
  status: "running" | "paused" | "stopped";
  pnl: number;
  trades: number;
  ema_fast: number;
  ema_slow: number;
};

export type Summary = {
  equity: number;
  cash: number;
  unrealized_pnl: number;
  realized_pnl: number;
  open_positions: number;
  win_rate: number;
  drawdown_pct: number;
  sharpe: number;
  latency_ms: number;
  messages_per_sec: number;
  ticks: number;
};

export type AccountBalance = {
  currency: string;
  free: number;
  locked: number;
  total: number;
};

export type AccountState = {
  account_id?: string;
  balances: AccountBalance[];
  equity?: number;
  margin_used?: number;
};

export type InstrumentInfo = {
  id: string;
  symbol: string;
  venue: string;
  kind?: string;
  price_precision?: number;
  size_precision?: number;
  tick_size?: number;
  lot_size?: number;
};

export type NodeStatus = {
  mode: string;
  running: boolean;
  state: string;
  trader_id?: string | null;
  instrument_id?: string | null;
  error?: string | null;
  backtest_running?: boolean;
  risk_state?: "ACTIVE" | "REDUCING" | "HALTED" | string;
};

export type Snapshot = {
  type?: "snapshot";
  summary: Summary;
  candles: Record<string, Candle[]>;
  equity_curve: EquityPoint[];
  positions: Position[];
  orders: Order[];
  fills: Fill[];
  events: FeedEvent[];
  strategies: Strategy[];
  symbols: string[];
  mode?: string;
  account?: AccountState;
  instruments?: InstrumentInfo[];
};

// --------------------------------------------------------------------- backtest catalog

export type StrategyField = {
  key: string;
  label: string;
  default: number;
  min?: number;
  max?: number;
};

export type StrategyCatalogItem = {
  id: string;
  name: string;
  kind: string;
  description: string;
  fields: StrategyField[];
};

export type DataSourceCatalogItem = {
  id: string;
  name: string;
  kind: string;
  strategies: string[];
  description: string;
  trade_size_default?: number;
  source?: string;
};

export type BacktestCatalog = {
  strategies: StrategyCatalogItem[];
  data_sources: DataSourceCatalogItem[];
};

export type BacktestParams = Record<string, number | string | null | undefined> & {
  strategy?: string;
  data_source?: string;
  n_bars?: number;
  starting_balance?: number;
  seed?: number | null;
  account_type?: "CASH" | "MARGIN";
  start_ts?: number | string | null;
  end_ts?: number | string | null;
};

export type BacktestMetrics = {
  total_pnl: number;
  final_equity: number;
  trades: number;
  win_rate: number;
  max_drawdown_pct: number;
  fills: number;
  sharpe?: number;
  sortino?: number;
  total_return_pct?: number;
  annual_return_pct?: number;
  max_drawdown_abs?: number;
  longest_dd_days?: number;
  avg_dd_days?: number;
  total_dd_days?: number;
  dd_count?: number;
  profit_factor?: number;
  profit_dd_ratio?: number;
  calmar?: number;
  romad?: number;
  volatility_252?: number;
  var5?: number;
  cvar5?: number;
  edge_vs_bh_pct?: number;
  fees_total?: number;
  gross_profit?: number;
  gross_loss?: number;
};

export type ClosedPosition = {
  id: string;
  symbol: string;
  side: string;
  qty: number;
  entry_price: number;
  mark_price: number;
  realized_pnl: number;
  opened_at: number;
  closed_at: number;
  strategy: string;
};

export type BacktestResult = {
  status: string;
  id?: string;
  elapsed_sec: number;
  params: {
    strategy?: string;
    data_source?: string;
    n_bars: number;
    fast_ema_period?: number;
    slow_ema_period?: number;
    trade_size?: number;
    starting_balance: number;
    account_type?: string;
    start_ts?: number | null;
    end_ts?: number | null;
  };
  metrics: BacktestMetrics;
  equity_curve: EquityPoint[];
  fills: Fill[];
  closed_positions: ClosedPosition[];
  orders: Order[];
  bars: Candle[];
};

export type BacktestHistoryItem = {
  id: string;
  strategy: string;
  data_source: string;
  elapsed_sec: number;
  metrics: BacktestMetrics;
  finished_at: number;
  params?: Record<string, unknown>;
};

export type BacktestStatus = {
  running: boolean;
  current: { id: string; strategy: string; data_source: string; started_at: number } | null;
  last_result: BacktestResult | null;
};

// --------------------------------------------------------------------- adapters / catalog

export type AdapterInfo = {
  id: string;
  name: string;
  type: string;
  data: boolean;
  exec: boolean;
  environments: string[];
  installed: boolean;
  live_ready: boolean;
  supported: boolean;
  status: string;
  credentials_configured: number;
  credentials_required: number;
  credential_env_names: string[];
  notes?: string | null;
};

export type CatalogFile = {
  path: string;
  abs_path: string;
  name: string;
  ext: string;
  size_bytes: number;
  kind: string;
  source: string;
};

export type CatalogResponse = {
  gui_data_dir: string;
  test_data_dir: string | null;
  files: CatalogFile[];
  catalogs: { name: string; path: string; exists: boolean }[];
};

export type StreamExtrasLike = {
  mode: string;
  node: NodeStatus | null;
  account: AccountState | null;
  instruments: InstrumentInfo[];
};

// --------------------------------------------------------------------- order ticket

export type OrderTicketPayload = {
  instrument_id: string;
  side: "buy" | "sell";
  type: "MARKET" | "LIMIT" | "STOP_MARKET" | "STOP_LIMIT";
  qty: string;
  price?: string | null;
  trigger_price?: string | null;
  tif?: "GTC" | "IOC" | "FOK" | "GTD" | "DAY";
  expires_at?: string | null;
};
