"use client";

import { useEffect, useState } from "react";
import { Loader2, OctagonAlert, Play, ShieldCheck, ShieldMinus, Square } from "lucide-react";
import { getAdapters, getNodeStatus, setRiskState, startSandbox, stopSandbox } from "@/lib/api";
import type { AdapterInfo, NodeStatus } from "@/lib/types";

export default function NodePanel({
  node,
  onChanged,
}: {
  node: NodeStatus | null;
  onChanged?: (n: NodeStatus) => void;
}) {
  const [status, setStatus] = useState<NodeStatus | null>(node);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [instrumentId, setInstrumentId] = useState("BTCUSDT.BINANCE");
  const [traderId, setTraderId] = useState("GUI-001");
  const [adapter, setAdapter] = useState("BINANCE");
  const [adapters, setAdapters] = useState<AdapterInfo[]>([]);
  const [attachEma, setAttachEma] = useState(false);
  const [emaFast, setEmaFast] = useState(10);
  const [emaSlow, setEmaSlow] = useState(50);
  const [tradeSize, setTradeSize] = useState("0.001");
  const [startingBalance, setStartingBalance] = useState("100000");
  const [reconciliation, setReconciliation] = useState(false);
  const [riskBusy, setRiskBusy] = useState(false);

  useEffect(() => {
    getAdapters()
      .then((list) => setAdapters(list.filter((a) => a.data && a.installed && a.supported)))
      .catch(() => setAdapters([]));
  }, []);

  useEffect(() => {
    if (node) setStatus(node);
  }, [node]);

  useEffect(() => {
    let cancelled = false;
    const poll = async () => {
      try {
        const s = await getNodeStatus();
        if (!cancelled) {
          setStatus(s);
          onChanged?.(s);
        }
      } catch {
        /* offline */
      }
    };
    poll();
    const id = setInterval(poll, 2000);
    return () => {
      cancelled = true;
      clearInterval(id);
    };
  }, [onChanged]);

  const running = !!status?.running;

  const start = async () => {
    setBusy(true);
    setError(null);
    try {
      const s = await startSandbox({
        instrument_id: instrumentId,
        trader_id: traderId,
        adapter,
        attach_ema_cross: attachEma,
        ema_fast: emaFast,
        ema_slow: emaSlow,
        trade_size: tradeSize,
        starting_balance: startingBalance,
        reconciliation,
      });
      setStatus(s);
      onChanged?.(s);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Start failed");
    } finally {
      setBusy(false);
    }
  };

  const stop = async () => {
    setBusy(true);
    setError(null);
    try {
      const s = await stopSandbox();
      setStatus(s);
      onChanged?.(s);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Stop failed");
    } finally {
      setBusy(false);
    }
  };

  const changeRisk = async (state: "ACTIVE" | "REDUCING" | "HALTED") => {
    setRiskBusy(true);
    setError(null);
    try {
      await setRiskState(state);
      const s = await getNodeStatus();
      setStatus(s);
      onChanged?.(s);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Risk state change failed");
    } finally {
      setRiskBusy(false);
    }
  };

  const riskState = (status?.risk_state || "ACTIVE").toUpperCase();

  const inputCls =
    "w-full rounded-lg bg-white/[0.04] border border-white/[0.08] px-3 py-2 text-[13px] font-mono text-white outline-none focus:border-indigo-500/60 transition";
  const labelCls = "block text-[11px] font-semibold uppercase tracking-wider text-slate-500 mb-1.5";

  return (
    <div className="panel p-5">
      <div className="flex items-start justify-between gap-3 mb-4">
        <div>
          <h3 className="text-sm font-semibold text-white">Sandbox LiveNode</h3>
          <p className="text-[12px] text-slate-500 mt-0.5">
            Live market data adapter + local simulated fills — no real funds
          </p>
        </div>
        <span
          className={`text-[10px] font-bold uppercase px-2 py-0.5 rounded shrink-0 ${
            status?.running
              ? "bg-emerald-500/15 text-emerald-400"
              : status?.state === "FAULTED"
                ? "bg-rose-500/15 text-rose-400"
                : "bg-slate-500/15 text-slate-400"
          }`}
        >
          {status?.state || (status?.running ? "RUNNING" : "STOPPED")}
        </span>
      </div>

      {running && (
        <div className="mb-4">
          <div className="flex items-center justify-between mb-1.5">
            <span className={labelCls}>Trading state (kill switch)</span>
            <span
              className={`text-[10px] font-bold uppercase px-2 py-0.5 rounded ${
                riskState === "HALTED"
                  ? "bg-rose-500/15 text-rose-400"
                  : riskState === "REDUCING"
                    ? "bg-amber-500/15 text-amber-400"
                    : "bg-emerald-500/15 text-emerald-400"
              }`}
            >
              {riskState}
            </span>
          </div>
          <div className="grid grid-cols-3 gap-1.5">
            <button
              type="button"
              onClick={() => changeRisk("ACTIVE")}
              disabled={riskBusy || riskState === "ACTIVE"}
              className="inline-flex items-center justify-center gap-1 rounded-lg bg-emerald-500/15 text-emerald-400 hover:bg-emerald-500/25 disabled:opacity-40 text-[11px] font-bold uppercase px-2 py-1.5 transition"
            >
              <ShieldCheck className="w-3.5 h-3.5" /> Active
            </button>
            <button
              type="button"
              onClick={() => changeRisk("REDUCING")}
              disabled={riskBusy || riskState === "REDUCING"}
              className="inline-flex items-center justify-center gap-1 rounded-lg bg-amber-500/15 text-amber-400 hover:bg-amber-500/25 disabled:opacity-40 text-[11px] font-bold uppercase px-2 py-1.5 transition"
            >
              <ShieldMinus className="w-3.5 h-3.5" /> Reducing
            </button>
            <button
              type="button"
              onClick={() => changeRisk("HALTED")}
              disabled={riskBusy || riskState === "HALTED"}
              className="inline-flex items-center justify-center gap-1 rounded-lg bg-rose-500/15 text-rose-400 hover:bg-rose-500/30 disabled:opacity-40 text-[11px] font-bold uppercase px-2 py-1.5 transition"
            >
              <OctagonAlert className="w-3.5 h-3.5" /> Halt
            </button>
          </div>
        </div>
      )}

      <dl className="space-y-2 text-[13px] mb-4">
        <div className="flex justify-between gap-3">
          <dt className="text-slate-500">Mode</dt>
          <dd className="font-mono text-slate-200">{status?.mode || "replay"}</dd>
        </div>
        <div className="flex justify-between gap-3">
          <dt className="text-slate-500">Trader</dt>
          <dd className="font-mono text-slate-200">{status?.trader_id || "—"}</dd>
        </div>
        <div className="flex justify-between gap-3">
          <dt className="text-slate-500">Instrument</dt>
          <dd className="font-mono text-slate-200 break-all text-right">
            {status?.instrument_id || "—"}
          </dd>
        </div>
        {status?.error && (
          <div className="p-2 rounded-lg bg-rose-500/10 border border-rose-500/20">
            <p className="text-[12px] text-rose-400 font-mono break-all">{status.error}</p>
          </div>
        )}
      </dl>

      {!running && (
        <div className="grid grid-cols-2 gap-3 mb-3">
          <label className="block col-span-2">
            <span className={labelCls}>Instrument ID</span>
            <input value={instrumentId} onChange={(e) => setInstrumentId(e.target.value)} className={inputCls} />
          </label>
          <label className="block">
            <span className={labelCls}>Market data adapter</span>
            <select
              value={adapter}
              onChange={(e) => setAdapter(e.target.value)}
              className={inputCls}
            >
              {(adapters.length
                ? adapters
                : [{ id: "BINANCE", name: "Binance" } as AdapterInfo]
              ).map((a) => (
                <option key={a.id} value={a.id} className="bg-slate-900">
                  {a.name}
                </option>
              ))}
            </select>
          </label>
          <label className="block">
            <span className={labelCls}>Trader ID</span>
            <input value={traderId} onChange={(e) => setTraderId(e.target.value)} className={inputCls} />
          </label>
          <label className="block">
            <span className={labelCls}>Starting balance (USDT)</span>
            <input
              value={startingBalance}
              onChange={(e) => setStartingBalance(e.target.value)}
              className={inputCls}
            />
          </label>
          <label className="block">
            <span className={labelCls}>Trade size</span>
            <input value={tradeSize} onChange={(e) => setTradeSize(e.target.value)} className={inputCls} />
          </label>
          <label className="block flex items-end gap-2 pb-2">
            <input
              type="checkbox"
              checked={attachEma}
              onChange={(e) => setAttachEma(e.target.checked)}
              className="w-4 h-4 accent-indigo-500"
            />
            <span className="text-[13px] text-slate-300">Attach EmaCross</span>
          </label>
          <label
            className="block flex items-end gap-2 pb-2"
            title="Replay venue open orders/positions into cache when the node starts"
          >
            <input
              type="checkbox"
              checked={reconciliation}
              onChange={(e) => setReconciliation(e.target.checked)}
              className="w-4 h-4 accent-indigo-500"
            />
            <span className="text-[13px] text-slate-300">Reconcile cache on start</span>
          </label>
          {attachEma && (
            <>
              <label className="block">
                <span className={labelCls}>Fast</span>
                <input
                  type="number"
                  value={emaFast}
                  onChange={(e) => setEmaFast(Number(e.target.value))}
                  className={inputCls}
                />
              </label>
              <label className="block">
                <span className={labelCls}>Slow</span>
                <input
                  type="number"
                  value={emaSlow}
                  onChange={(e) => setEmaSlow(Number(e.target.value))}
                  className={inputCls}
                />
              </label>
            </>
          )}
        </div>
      )}

      <button
        onClick={running ? stop : start}
        disabled={busy}
        className={`w-full inline-flex items-center justify-center gap-2 rounded-xl text-white text-[13px] font-semibold px-4 py-2.5 transition ${
          running
            ? "bg-rose-500 hover:bg-rose-400 disabled:bg-rose-500/40"
            : "bg-emerald-500 hover:bg-emerald-400 disabled:bg-emerald-500/40"
        } disabled:cursor-not-allowed`}
      >
        {busy ? (
          <Loader2 className="w-4 h-4 animate-spin" />
        ) : running ? (
          <Square className="w-4 h-4" />
        ) : (
          <Play className="w-4 h-4" />
        )}
        {busy ? "Working…" : running ? "Stop node" : "Start sandbox node"}
      </button>

      {error && <p className="mt-2 text-[12.5px] text-rose-400 font-mono break-all">{error}</p>}
    </div>
  );
}
