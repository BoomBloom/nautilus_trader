"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { FlaskConical, History, Loader2 } from "lucide-react";
import EquityChart from "@/components/EquityChart";
import StatCard from "@/components/StatCard";
import { FillsTable } from "@/components/Tables";
import { fmtDateTime, fmtMoney, fmtNum, fmtSigned } from "@/lib/format";
import { getBacktestCatalog, getBacktestHistory, getBacktestStatus, runBacktest } from "@/lib/api";
import type {
  BacktestCatalog,
  BacktestHistoryItem,
  BacktestResult,
  BacktestStatus,
} from "@/lib/types";

const FALLBACK_CATALOG: BacktestCatalog = {
  strategies: [
    {
      id: "gui_ema",
      name: "GUI EMA Cross (streaming)",
      kind: "bars",
      description: "EMA crossover that streams candles, signals and fills into the dashboard live.",
      fields: [
        { key: "fast_ema_period", label: "Fast EMA", default: 10, min: 2, max: 200 },
        { key: "slow_ema_period", label: "Slow EMA", default: 20, min: 3, max: 400 },
        { key: "trade_size", label: "Trade size", default: 100000, min: 0.0001, max: 1e12 },
      ],
    },
    {
      id: "ema_cross",
      name: "Builtin EmaCross (quotes)",
      kind: "quotes",
      description: "NautilusTrader's built-in dual-EMA crossover driven by quote ticks.",
      fields: [
        { key: "fast_ema_period", label: "Fast period", default: 10, min: 2, max: 200 },
        { key: "slow_ema_period", label: "Slow period", default: 50, min: 3, max: 400 },
        { key: "trade_size", label: "Trade size", default: 100000, min: 0.0001, max: 1e12 },
      ],
    },
  ],
  data_sources: [
    {
      id: "synthetic_fx",
      name: "Synthetic AUD/USD 1-min bars",
      kind: "bars",
      strategies: ["gui_ema"],
      description: "Random-walk FX bars on the SIM venue.",
      trade_size_default: 100000,
    },
    {
      id: "synthetic_eth",
      name: "Synthetic ETHUSDT 1-min bars",
      kind: "bars",
      strategies: ["gui_ema"],
      description: "Random-walk crypto bars on the BINANCE venue.",
      trade_size_default: 0.1,
    },
    {
      id: "audusd_quotes",
      name: "AUD/USD historical quotes (test kit)",
      kind: "quotes",
      strategies: ["ema_cross"],
      description: "3,000 bundled quote ticks from the Nautilus test kit.",
      trade_size_default: 100000,
    },
    {
      id: "binance_ethusdt_trades",
      name: "Binance ETHUSDT trade ticks (test kit)",
      kind: "trades",
      strategies: [],
      description: "69k+ historical trade ticks — for future trade-driven strategies.",
      trade_size_default: 0.1,
    },
  ],
};

function Field({
  label,
  value,
  min,
  max,
  step,
  onChange,
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  step?: number | string;
  onChange: (v: number) => void;
}) {
  return (
    <label className="block">
      <span className="block text-[11px] font-semibold uppercase tracking-wider text-slate-500 mb-1.5">
        {label}
      </span>
      <input
        type="number"
        value={value}
        min={min}
        max={max}
        step={step}
        onChange={(e) => onChange(Number(e.target.value))}
        className="w-full rounded-lg bg-white/[0.04] border border-white/[0.08] px-3 py-2 text-[13px] font-mono text-white outline-none focus:border-indigo-500/60 transition"
      />
    </label>
  );
}

function Select({
  label,
  value,
  options,
  onChange,
}: {
  label: string;
  value: string;
  options: { value: string; label: string; disabled?: boolean }[];
  onChange: (v: string) => void;
}) {
  return (
    <label className="block">
      <span className="block text-[11px] font-semibold uppercase tracking-wider text-slate-500 mb-1.5">
        {label}
      </span>
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="w-full rounded-lg bg-white/[0.04] border border-white/[0.08] px-3 py-2 text-[13px] font-mono text-white outline-none focus:border-indigo-500/60 transition"
      >
        {options.map((o) => (
          <option key={o.value} value={o.value} disabled={o.disabled} className="bg-slate-900">
            {o.label}
          </option>
        ))}
      </select>
    </label>
  );
}

export default function BacktestView() {
  const [catalog, setCatalog] = useState<BacktestCatalog>(FALLBACK_CATALOG);
  const [history, setHistory] = useState<BacktestHistoryItem[]>([]);
  const [status, setStatus] = useState<BacktestStatus | null>(null);
  const [strategyId, setStrategyId] = useState("gui_ema");
  const [dataSourceId, setDataSourceId] = useState("synthetic_fx");
  const [fieldValues, setFieldValues] = useState<Record<string, number>>({});
  const [nBars, setNBars] = useState(600);
  const [startingBalance, setStartingBalance] = useState(100000);
  const [seed, setSeed] = useState<number | null>(7);
  const [accountType, setAccountType] = useState<"CASH" | "MARGIN">("MARGIN");
  const [startDate, setStartDate] = useState("");
  const [endDate, setEndDate] = useState("");
  const [result, setResult] = useState<BacktestResult | null>(null);
  const [running, setRunning] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const isoToEpoch = (s: string): number | null => {
    if (!s) return null;
    const t = Date.parse(s.endsWith("Z") || s.includes("T") ? s : `${s}T00:00:00Z`);
    return Number.isFinite(t) ? Math.floor(t / 1000) : null;
  };

  const refreshMeta = useCallback(async () => {
    try {
      const [cat, hist, st] = await Promise.all([
        getBacktestCatalog(),
        getBacktestHistory(20),
        getBacktestStatus(),
      ]);
      if (cat?.strategies?.length) setCatalog(cat);
      setHistory(hist || []);
      setStatus(st);
      if (st?.running) setRunning(true);
      if (st?.last_result) setResult(st.last_result);
    } catch {
      /* backend offline — keep fallback catalog */
    }
  }, []);

  useEffect(() => {
    refreshMeta();
  }, [refreshMeta]);

  const dataSource = useMemo(
    () => catalog.data_sources.find((d) => d.id === dataSourceId) || catalog.data_sources[0],
    [catalog, dataSourceId],
  );

  const compatibleStrategies = useMemo(() => {
    if (!dataSource) return catalog.strategies;
    const ids = dataSource.strategies || [];
    if (!ids.length) return catalog.strategies.filter((s) => false);
    return catalog.strategies.filter((s) => ids.includes(s.id));
  }, [catalog, dataSource]);

  const strategy = useMemo(
    () =>
      compatibleStrategies.find((s) => s.id === strategyId) || compatibleStrategies[0] || null,
    [compatibleStrategies, strategyId],
  );

  const allowedSourcesFor = useCallback(
    (sid: string) => catalog.data_sources.filter((d) => (d.strategies || []).includes(sid)),
    [catalog],
  );

  const onStrategyChange = (sid: string) => {
    setStrategyId(sid);
    const allowed = allowedSourcesFor(sid);
    if (allowed.length && !allowed.some((d) => d.id === dataSourceId)) {
      setDataSourceId(allowed[0].id);
      applyDefaultsFor(sid, allowed[0]);
      return;
    }
    const src = catalog.data_sources.find((d) => d.id === dataSourceId);
    if (src) applyDefaultsFor(sid, src);
  };

  const applyDefaultsFor = (sid: string, src: { id: string; trade_size_default?: number }) => {
    const strat = catalog.strategies.find((s) => s.id === sid);
    const next: Record<string, number> = {};
    for (const f of strat?.fields || []) {
      if (f.key === "trade_size" && src.trade_size_default != null) {
        next[f.key] = src.trade_size_default;
      } else {
        next[f.key] = f.default;
      }
    }
    setFieldValues(next);
  };

  const onDataSourceChange = (did: string) => {
    setDataSourceId(did);
    const src = catalog.data_sources.find((d) => d.id === did);
    if (!src) return;
    if (strategyId && !(src.strategies || []).includes(strategyId)) {
      const first = (src.strategies || [])[0];
      if (first) {
        setStrategyId(first);
        applyDefaultsFor(first, src);
        return;
      }
    }
    applyDefaultsFor(strategyId, src);
  };

  useEffect(() => {
    if (strategy && dataSource && Object.keys(fieldValues).length === 0) {
      applyDefaultsFor(strategy.id, dataSource);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [strategy, dataSource]);

  const canRun = !!strategy && !!dataSource && !running && (dataSource.strategies || []).length > 0;

  const run = async () => {
    if (!strategy || !dataSource) return;
    setRunning(true);
    setError(null);
    try {
      const params: Record<string, unknown> = {
        strategy: strategy.id,
        data_source: dataSource.id,
        n_bars: nBars,
        starting_balance: startingBalance,
        seed,
        account_type: accountType,
        ...fieldValues,
      };
      const startTs = isoToEpoch(startDate);
      const endTs = isoToEpoch(endDate);
      if (startTs != null) params.start_ts = startTs;
      if (endTs != null) params.end_ts = endTs;
      if (startTs != null && endTs != null && startTs > endTs) {
        setError("Start date must be on or before end date");
        setRunning(false);
        return;
      }
      const data = await runBacktest(params);
      setResult(data);
      const hist = await getBacktestHistory(20).catch(() => null);
      if (hist) setHistory(hist);
      const st = await getBacktestStatus().catch(() => null);
      if (st) setStatus(st);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Backtest failed");
    } finally {
      setRunning(false);
    }
  };

  const m = result?.metrics;
  const noStrategies = dataSource && (dataSource.strategies || []).length === 0;
  const isFileSource = dataSource?.id?.startsWith("file:");

  return (
    <div className="space-y-5">
      <div className="panel p-5 animate-fadeUp">
        <div className="flex items-center justify-between mb-4">
          <div>
            <h3 className="text-sm font-semibold text-white flex items-center gap-2">
              <FlaskConical className="w-4 h-4 text-indigo-400" />
              Run configuration
            </h3>
            <p className="text-[12px] text-slate-500 mt-0.5">
              {strategy?.description ||
                "Pick a strategy and data source from the catalog (synthetic, test-kit, or local files)"}
            </p>
            {isFileSource && dataSource && (
              <p className="text-[11px] font-mono text-indigo-300/80 mt-0.5 break-all">
                {dataSource.description}
              </p>
            )}
          </div>
          <button
            onClick={run}
            disabled={!canRun}
            className="inline-flex items-center gap-2 rounded-xl bg-indigo-500 hover:bg-indigo-400 disabled:bg-indigo-500/40 disabled:cursor-not-allowed text-white text-[13px] font-semibold px-4 py-2 transition"
          >
            {running ? (
              <>
                <Loader2 className="w-4 h-4 animate-spin" />
                Running…
              </>
            ) : (
              "Run backtest"
            )}
          </button>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 mb-4">
          <Select
            label="Data source"
            value={dataSourceId}
            options={catalog.data_sources.map((d) => ({
              value: d.id,
              label: d.name,
              disabled: (d.strategies || []).length === 0,
            }))}
            onChange={onDataSourceChange}
          />
          <Select
            label="Strategy"
            value={strategy?.id || ""}
            options={compatibleStrategies.map((s) => ({
              value: s.id,
              label: s.name,
            }))}
            onChange={onStrategyChange}
          />
          <Field label="Bars / ticks" value={nBars} min={50} max={10000} onChange={setNBars} />
          <Field
            label="Starting balance"
            value={startingBalance}
            min={1000}
            max={1e9}
            onChange={setStartingBalance}
          />
          <Select
            label="Account type"
            value={accountType}
            options={[
              { value: "MARGIN", label: "Margin" },
              { value: "CASH", label: "Cash" },
            ]}
            onChange={(v) => setAccountType(v as "CASH" | "MARGIN")}
          />
          <label className="block">
            <span className="block text-[11px] font-semibold uppercase tracking-wider text-slate-500 mb-1.5">
              Start date (optional)
            </span>
            <input
              type="date"
              value={startDate}
              onChange={(e) => setStartDate(e.target.value)}
              className="w-full rounded-lg bg-white/[0.04] border border-white/[0.08] px-3 py-2 text-[13px] font-mono text-white outline-none focus:border-indigo-500/60 transition"
            />
          </label>
          <label className="block">
            <span className="block text-[11px] font-semibold uppercase tracking-wider text-slate-500 mb-1.5">
              End date (optional)
            </span>
            <input
              type="date"
              value={endDate}
              onChange={(e) => setEndDate(e.target.value)}
              className="w-full rounded-lg bg-white/[0.04] border border-white/[0.08] px-3 py-2 text-[13px] font-mono text-white outline-none focus:border-indigo-500/60 transition"
            />
          </label>
        </div>

        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-4">
          {(strategy?.fields || []).map((f) => (
            <Field
              key={f.key}
              label={f.label}
              value={fieldValues[f.key] ?? f.default}
              min={f.min ?? 0}
              max={f.max ?? 1e12}
              step={f.key === "trade_size" ? "any" : 1}
              onChange={(v) => setFieldValues((prev) => ({ ...prev, [f.key]: v }))}
            />
          ))}
          <Field
            label="Seed"
            value={Number(seed ?? 0)}
            min={0}
            max={99999}
            onChange={(v) => setSeed(v)}
          />
        </div>

        {noStrategies && (
          <p className="mt-3 text-[13px] text-amber-400">
            This data source has no strategies wired yet — pick another source.
          </p>
        )}
        {error && (
          <p className="mt-3 text-[13px] text-rose-400 font-mono break-all">{error}</p>
        )}
      </div>

      {history.length > 0 && (
        <div className="panel overflow-hidden animate-fadeUp" style={{ animationDelay: "40ms" }}>
          <div className="flex items-center justify-between px-5 pt-4 pb-3">
            <h3 className="text-sm font-semibold text-white flex items-center gap-2">
              <History className="w-4 h-4 text-indigo-400" />
              Recent runs
            </h3>
            <span className="text-[11px] text-slate-500">{history.length} runs (this process)</span>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-[13px] min-w-[640px]">
              <thead>
                <tr className="text-left text-[10px] uppercase tracking-wider text-slate-500 border-y border-white/[0.06]">
                  <th className="font-semibold px-5 py-2.5">Finished</th>
                  <th className="font-semibold px-5 py-2.5">Strategy</th>
                  <th className="font-semibold px-5 py-2.5">Data source</th>
                  <th className="font-semibold px-5 py-2.5 text-right">PnL</th>
                  <th className="font-semibold px-5 py-2.5 text-right">Trades</th>
                  <th className="font-semibold px-5 py-2.5 text-right">Win %</th>
                  <th className="font-semibold px-5 py-2.5 text-right">Elapsed</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-white/[0.04]">
                {history.map((h) => (
                  <tr key={h.id} className="hover:bg-white/[0.03] transition">
                    <td className="px-5 py-2.5 font-mono text-slate-500 text-[12px]">
                      {fmtDateTime(h.finished_at)}
                    </td>
                    <td className="px-5 py-2.5 font-semibold text-white">{h.strategy}</td>
                    <td className="px-5 py-2.5 text-slate-400">{h.data_source}</td>
                    <td
                      className={`px-5 py-2.5 text-right font-mono font-semibold ${
                        (h.metrics?.total_pnl ?? 0) >= 0 ? "text-emerald-400" : "text-rose-400"
                      }`}
                    >
                      {fmtSigned(h.metrics?.total_pnl ?? 0)}
                    </td>
                    <td className="px-5 py-2.5 text-right font-mono text-slate-300">
                      {h.metrics?.trades ?? 0}
                    </td>
                    <td className="px-5 py-2.5 text-right font-mono text-slate-300">
                      {h.metrics?.win_rate ?? 0}%
                    </td>
                    <td className="px-5 py-2.5 text-right font-mono text-slate-400">
                      {h.elapsed_sec}s
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {!result && !running && (
        <div className="panel p-8 text-center animate-fadeUp" style={{ animationDelay: "60ms" }}>
          <FlaskConical className="w-8 h-8 text-slate-600 mx-auto mb-3" />
          <h3 className="text-sm font-semibold text-white">No backtest yet</h3>
          <p className="text-[13px] text-slate-500 mt-1">
            Configure parameters above and hit <span className="text-indigo-400 font-semibold">Run backtest</span>{" "}
            — results stream live into this page and the Monitor feed.
          </p>
          {status?.running && (
            <p className="text-[13px] text-amber-400 mt-2">A run is already in progress…</p>
          )}
        </div>
      )}

      {m && result && (
        <>
          <div className="grid grid-cols-2 lg:grid-cols-3 xl:grid-cols-6 gap-4">
            <StatCard
              label="Total PnL"
              value={fmtSigned(m.total_pnl)}
              deltaLabel={`${result.params.n_bars} units · ${result.elapsed_sec}s`}
              accent={m.total_pnl >= 0 ? "#10b981" : "#f43f5e"}
              delay={40}
            />
            <StatCard
              label="Final equity"
              value={fmtMoney(m.final_equity)}
              deltaLabel={`from ${fmtMoney(result.params.starting_balance, 0)}`}
              accent="#6366f1"
              delay={90}
            />
            <StatCard
              label="Trades"
              value={String(m.trades)}
              deltaLabel={`${m.fills} fills`}
              accent="#06b6d4"
              delay={140}
            />
            <StatCard
              label="Win rate"
              value={`${m.win_rate}%`}
              deltaLabel="closed positions"
              accent="#f59e0b"
              delay={190}
            />
            <StatCard
              label="Max drawdown"
              value={`${m.max_drawdown_pct}%`}
              deltaLabel={
                m.max_drawdown_abs != null ? `−${fmtMoney(m.max_drawdown_abs)}` : "peak to trough"
              }
              accent="#f43f5e"
              delay={240}
            />
            <StatCard
              label="Strategy"
              value={result.params.strategy || strategyId}
              deltaLabel={
                [
                  result.params.data_source || dataSourceId,
                  result.params.account_type || accountType,
                ].join(" · ") || dataSourceId
              }
              accent="#8b5cf6"
              delay={290}
            />
          </div>

          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-6 gap-3">
            {[
              { label: "Sharpe", value: fmtNum(m.sharpe ?? 0, 2), color: "#6366f1" },
              { label: "Sortino", value: fmtNum(m.sortino ?? 0, 2), color: "#6366f1" },
              {
                label: "Total return",
                value: `${fmtNum(m.total_return_pct ?? 0, 2)}%`,
                color: (m.total_return_pct ?? 0) >= 0 ? "#10b981" : "#f43f5e",
              },
              {
                label: "Annual return",
                value: `${fmtNum(m.annual_return_pct ?? 0, 2)}%`,
                color: (m.annual_return_pct ?? 0) >= 0 ? "#10b981" : "#f43f5e",
              },
              { label: "Profit factor", value: fmtNum(m.profit_factor ?? 0, 2), color: "#06b6d4" },
              { label: "Calmar", value: fmtNum(m.calmar ?? 0, 2), color: "#06b6d4" },
              {
                label: "Longest DD",
                value: `${fmtNum(m.longest_dd_days ?? 0, 1)}d`,
                color: "#f43f5e",
              },
              {
                label: "Avg DD",
                value: `${fmtNum(m.avg_dd_days ?? 0, 1)}d`,
                color: "#f43f5e",
              },
              { label: "DD count", value: String(m.dd_count ?? 0), color: "#f43f5e" },
              { label: "VaR 5%", value: `${fmtNum(m.var5 ?? 0, 3)}%`, color: "#f59e0b" },
              { label: "CVaR 5%", value: `${fmtNum(m.cvar5 ?? 0, 3)}%`, color: "#f59e0b" },
              {
                label: "Edge vs B&H",
                value: `${fmtNum(m.edge_vs_bh_pct ?? 0, 2)}%`,
                color: (m.edge_vs_bh_pct ?? 0) >= 0 ? "#10b981" : "#f43f5e",
              },
              { label: "Fees", value: fmtMoney(m.fees_total ?? 0), color: "#f59e0b" },
              { label: "Profit/DD", value: fmtNum(m.profit_dd_ratio ?? 0, 2), color: "#8b5cf6" },
              { label: "Romad", value: fmtNum(m.romad ?? 0, 2), color: "#8b5cf6" },
              {
                label: "Volatility (252)",
                value: fmtNum(m.volatility_252 ?? 0, 3),
                color: "#06b6d4",
              },
            ].map((k) => (
              <div
                key={k.label}
                className="panel p-3 border border-white/[0.04] bg-white/[0.02]"
              >
                <div className="text-[10px] uppercase tracking-wider text-slate-500 font-semibold">
                  {k.label}
                </div>
                <div className="mt-1 font-mono text-[15px] font-semibold" style={{ color: k.color }}>
                  {k.value}
                </div>
              </div>
            ))}
          </div>

          <div className="panel p-5">
            <div className="flex items-center justify-between mb-3">
              <div>
                <h3 className="text-sm font-semibold text-white">Equity curve</h3>
                <p className="text-[12px] text-slate-500 mt-0.5">
                  Account total across the backtest session
                </p>
              </div>
              <span className="text-[11px] font-mono text-slate-500">
                {result.equity_curve.length} points
              </span>
            </div>
            <EquityChart points={result.equity_curve} />
          </div>

          <div className="panel overflow-hidden">
            <div className="flex items-center justify-between px-5 pt-4 pb-3">
              <h3 className="text-sm font-semibold text-white">Closed positions</h3>
              <span className="text-[11px] text-slate-500">{result.closed_positions.length} trades</span>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-[13px] min-w-[640px]">
                <thead>
                  <tr className="text-left text-[10px] uppercase tracking-wider text-slate-500 border-y border-white/[0.06]">
                    <th className="font-semibold px-5 py-2.5">Closed at</th>
                    <th className="font-semibold px-5 py-2.5">Symbol</th>
                    <th className="font-semibold px-5 py-2.5">Side</th>
                    <th className="font-semibold px-5 py-2.5 text-right">Qty</th>
                    <th className="font-semibold px-5 py-2.5 text-right">Entry</th>
                    <th className="font-semibold px-5 py-2.5 text-right">Exit</th>
                    <th className="font-semibold px-5 py-2.5 text-right">Realized PnL</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-white/[0.04]">
                  {result.closed_positions.length === 0 && (
                    <tr>
                      <td colSpan={7} className="px-5 py-6 text-center text-slate-500 text-[13px]">
                        No positions closed — try more bars or a different seed
                      </td>
                    </tr>
                  )}
                  {result.closed_positions.map((p) => (
                    <tr key={p.id + p.closed_at} className="hover:bg-white/[0.03] transition">
                      <td className="px-5 py-2.5 font-mono text-slate-500 text-[12px]">
                        {new Date(p.closed_at * 1000).toLocaleString("en-US", {
                          month: "short",
                          day: "2-digit",
                          hour: "2-digit",
                          minute: "2-digit",
                          hour12: false,
                        })}
                      </td>
                      <td className="px-5 py-2.5 font-semibold text-white">{p.symbol}</td>
                      <td className="px-5 py-2.5">
                        <span
                          className={`text-[11px] font-bold px-2 py-0.5 rounded ${
                            p.side === "buy"
                              ? "bg-emerald-500/15 text-emerald-400"
                              : "bg-rose-500/15 text-rose-400"
                          }`}
                        >
                          {p.side.toUpperCase()}
                        </span>
                      </td>
                      <td className="px-5 py-2.5 text-right font-mono text-slate-300">{fmtNum(p.qty, 4)}</td>
                      <td className="px-5 py-2.5 text-right font-mono text-slate-300">{fmtMoney(p.entry_price, 5)}</td>
                      <td className="px-5 py-2.5 text-right font-mono text-slate-300">{fmtMoney(p.mark_price, 5)}</td>
                      <td
                        className={`px-5 py-2.5 text-right font-mono font-semibold ${
                          p.realized_pnl >= 0 ? "text-emerald-400" : "text-rose-400"
                        }`}
                      >
                        {p.realized_pnl >= 0 ? "+" : ""}
                        {fmtMoney(p.realized_pnl)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          <FillsTable fills={result.fills} />

          <div className="panel overflow-hidden">
            <div className="flex items-center justify-between px-5 pt-4 pb-3">
              <h3 className="text-sm font-semibold text-white">Order log</h3>
              <span className="text-[11px] text-slate-500">last {result.orders.length}</span>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-[13px] min-w-[560px]">
                <thead>
                  <tr className="text-left text-[10px] uppercase tracking-wider text-slate-500 border-y border-white/[0.06]">
                    <th className="font-semibold px-5 py-2.5">ID</th>
                    <th className="font-semibold px-5 py-2.5">Symbol</th>
                    <th className="font-semibold px-5 py-2.5">Side</th>
                    <th className="font-semibold px-5 py-2.5 text-right">Qty</th>
                    <th className="font-semibold px-5 py-2.5">Status</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-white/[0.04]">
                  {result.orders.length === 0 && (
                    <tr>
                      <td colSpan={5} className="px-5 py-6 text-center text-slate-500 text-[13px]">
                        No orders submitted
                      </td>
                    </tr>
                  )}
                  {result.orders.map((o) => (
                    <tr key={o.id} className="hover:bg-white/[0.03] transition">
                      <td className="px-5 py-2.5 font-mono text-slate-500 text-[12px]">{o.id}</td>
                      <td className="px-5 py-2.5 font-semibold text-white">{o.symbol}</td>
                      <td className="px-5 py-2.5">
                        <span className={o.side === "buy" ? "text-emerald-400" : "text-rose-400"}>
                          {o.side.toUpperCase()}
                        </span>
                      </td>
                      <td className="px-5 py-2.5 text-right font-mono text-slate-300">{fmtNum(o.qty, 4)}</td>
                      <td className="px-5 py-2.5">
                        <span className="text-[11px] font-bold px-2 py-0.5 rounded bg-indigo-500/15 text-indigo-300">
                          {o.status}
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
