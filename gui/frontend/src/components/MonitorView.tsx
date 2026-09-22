"use client";

import StatCard from "@/components/StatCard";
import PriceChart from "@/components/PriceChart";
import EquityChart from "@/components/EquityChart";
import { FillsTable, OrdersTable, PositionsTable } from "@/components/Tables";
import { EventFeed, StrategyPanel } from "@/components/Panels";
import { closePosition } from "@/lib/api";
import { fmtMoney, fmtSigned } from "@/lib/format";
import type { Snapshot } from "@/lib/types";

export default function MonitorView({
  snapshot,
  selected,
  candles,
}: {
  snapshot: Snapshot | null;
  selected: string;
  candles: Snapshot["candles"][string];
}) {
  const s = snapshot?.summary;
  const positions = snapshot?.positions ?? [];
  const fills = snapshot?.fills ?? [];
  const orders = snapshot?.orders ?? [];
  const events = snapshot?.events ?? [];
  const strategies = snapshot?.strategies ?? [];
  const equityCurve = snapshot?.equity_curve ?? [];
  const openPnl = positions.reduce((a, p) => a + p.unrealized_pnl, 0);
  const live = snapshot?.mode === "live";

  return (
    <div className="space-y-5">
      <section className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-4">
        <StatCard
          label="Account Equity"
          value={s ? fmtMoney(s.equity) : "—"}
          delta={s?.drawdown_pct ?? 0}
          deltaLabel="drawdown"
          accent="#6366f1"
          delay={40}
        />
        <StatCard
          label="Unrealized PnL"
          value={s ? fmtSigned(s.unrealized_pnl) : "—"}
          deltaLabel={`${positions.length} open positions`}
          accent="#06b6d4"
          delay={90}
        />
        <StatCard
          label="Realized PnL"
          value={s ? fmtSigned(s.realized_pnl) : "—"}
          deltaLabel={s ? `Sharpe ${s.sharpe}` : ""}
          accent="#10b981"
          delay={140}
        />
        <StatCard
          label="Engine Health"
          value={s ? `${s.latency_ms} ms` : "—"}
          deltaLabel={s ? `${s.messages_per_sec} msg/s` : ""}
          accent="#f43f5e"
          delay={190}
        />
      </section>

      <section className="grid grid-cols-1 xl:grid-cols-3 gap-5">
        <div className="xl:col-span-2 panel p-5 animate-fadeUp" style={{ animationDelay: "220ms" }}>
          <div className="flex items-start justify-between mb-4">
            <div>
              <h2 className="text-sm font-semibold text-white">
                {selected} <span className="text-slate-500 font-normal">· candles + fills</span>
              </h2>
              <p className="text-[12px] text-slate-500 mt-0.5">Arrows mark executed fills</p>
            </div>
            <div className="flex items-center gap-1 p-1 rounded-lg bg-white/[0.05] text-[11px] font-semibold text-slate-400">
              <span className="px-2 py-1 rounded bg-indigo-500/20 text-indigo-300">1m</span>
              <span className="px-2 py-1">5m</span>
              <span className="px-2 py-1">15m</span>
            </div>
          </div>
          <PriceChart candles={candles} fills={fills} positions={positions} />
        </div>

        <div className="panel p-5 animate-fadeUp" style={{ animationDelay: "260ms" }}>
          <div className="flex items-start justify-between mb-4">
            <div>
              <h2 className="text-sm font-semibold text-white">Equity Curve</h2>
              <p className="text-[12px] text-slate-500 mt-0.5">
                {s ? fmtMoney(s.equity) : "—"} · win rate {s ? s.win_rate : "—"}%
              </p>
            </div>
          </div>
          <EquityChart points={equityCurve} />
          <div className="mt-4 grid grid-cols-2 gap-3">
            <div className="p-3 rounded-xl bg-white/[0.03] border border-white/[0.05]">
              <p className="text-[10px] uppercase tracking-wider text-slate-500 font-semibold">Cash</p>
              <p className="text-[15px] font-bold text-white mt-1 font-mono">
                {s ? fmtMoney(s.cash) : "—"}
              </p>
            </div>
            <div className="p-3 rounded-xl bg-white/[0.03] border border-white/[0.05]">
              <p className="text-[10px] uppercase tracking-wider text-slate-500 font-semibold">Open uPnL</p>
              <p
                className={`text-[15px] font-bold mt-1 font-mono ${
                  openPnl >= 0 ? "text-emerald-400" : "text-rose-400"
                }`}
              >
                {fmtSigned(openPnl)}
              </p>
            </div>
          </div>
        </div>
      </section>

      <section className="grid grid-cols-1 lg:grid-cols-3 gap-5">
        <div className="lg:col-span-2 space-y-5 animate-fadeUp" style={{ animationDelay: "300ms" }}>
          <PositionsTable
            positions={positions}
            onClose={
              live
                ? async (iid) => {
                    try {
                      await closePosition(iid);
                    } catch {
                      /* ignore */
                    }
                  }
                : undefined
            }
          />
          <FillsTable fills={fills} />
          <OrdersTable orders={orders} onCancel={live} allowCancelAll={live} />
        </div>
        <div className="space-y-5 animate-fadeUp" style={{ animationDelay: "340ms" }}>
          <StrategyPanel strategies={strategies} />
          <EventFeed events={events} />
        </div>
      </section>
    </div>
  );
}
