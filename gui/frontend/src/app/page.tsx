"use client";

import { useState } from "react";
import Sidebar from "@/components/Sidebar";
import Topbar from "@/components/Topbar";
import MonitorView from "@/components/MonitorView";
import BacktestView from "@/components/BacktestView";
import {
  EventsView,
  IntegrationsView,
  MarketsView,
  OrdersView,
  PositionsView,
  SettingsView,
  StrategiesView,
} from "@/components/Views";
import { useStream } from "@/lib/useStream";
import { VIEW_META, type ViewId } from "@/lib/nav";
import { fmtMoney } from "@/lib/format";

export default function Page() {
  const { snapshot, extras, live, lastMsg, selected, setSelected, candles } = useStream();
  const [view, setView] = useState<ViewId>("monitor");
  const [navOpen, setNavOpen] = useState(false);

  const symbols = snapshot?.symbols ?? ["BTC/USD", "ETH/USD", "SOL/USD"];
  const meta = VIEW_META[view];

  const last = candles.length ? candles[candles.length - 1].close : 0;
  const first = candles.length ? candles[0].close : 0;
  const move = first ? ((last - first) / first) * 100 : 0;

  const navigate = (id: ViewId) => {
    setView(id);
    setNavOpen(false);
    if (typeof window !== "undefined") window.scrollTo({ top: 0, behavior: "smooth" });
  };

  return (
    <div className="flex min-h-screen">
      <Sidebar active={view} onNavigate={navigate} />

      {navOpen && (
        <div
          className="fixed inset-0 z-40 bg-black/60 backdrop-blur-sm lg:hidden"
          onClick={() => setNavOpen(false)}
        />
      )}
      <div
        className={`fixed lg:hidden inset-y-0 left-0 z-50 w-64 transition-transform duration-300 ${
          navOpen ? "translate-x-0" : "-translate-x-full"
        }`}
      >
        <Sidebar active={view} onNavigate={navigate} embedded onClose={() => setNavOpen(false)} />
      </div>

      <div className="flex-1 min-w-0 flex flex-col">
        <Topbar
          live={live}
          lastMsg={lastMsg}
          selected={selected}
          onSelect={setSelected}
          symbols={symbols}
          onMenu={() => setNavOpen((v) => !v)}
        />

        <main className="p-4 sm:p-6 space-y-5">
          <div className="flex flex-wrap items-end justify-between gap-3 animate-fadeUp">
            <div>
              <p className="text-[12px] font-semibold text-indigo-400 mb-1">{meta.kicker}</p>
              <h1 className="text-2xl font-bold tracking-tight text-white">{meta.title}</h1>
              <p className="text-[13px] text-slate-500 mt-1">
                {meta.subtitle}
                {live ? " · connected" : " · reconnecting…"}
              </p>
            </div>
            <div className="flex items-center gap-4 text-[12px] font-mono text-slate-500">
              <span>
                <span className="text-slate-400">selected</span> {selected}{" "}
                <span className={move >= 0 ? "text-emerald-400" : "text-rose-400"}>
                  {move >= 0 ? "+" : ""}
                  {move.toFixed(2)}%
                </span>
              </span>
              <span>
                <span className="text-slate-400">last</span>{" "}
                <span className="text-white">{fmtMoney(last)}</span>
              </span>
            </div>
          </div>

          {view === "monitor" && (
            <MonitorView snapshot={snapshot} selected={selected} candles={candles} />
          )}
          {view === "backtest" && <BacktestView />}
          {view === "markets" && <MarketsView snapshot={snapshot} />}
          {view === "positions" && <PositionsView snapshot={snapshot} />}
          {view === "orders" && (
            <OrdersView
              snapshot={snapshot}
              extras={{ mode: extras.mode, instruments: extras.instruments }}
            />
          )}
          {view === "strategies" && <StrategiesView snapshot={snapshot} />}
          {view === "events" && <EventsView snapshot={snapshot} />}
          {view === "integrations" && <IntegrationsView />}
          {view === "settings" && (
            <SettingsView live={live} snapshot={snapshot} node={extras.node} />
          )}

          <footer className="pt-2 pb-4 flex flex-col sm:flex-row items-center justify-between gap-2 text-[12px] text-slate-600">
            <p>Nautilus GUI · Next.js + FastAPI · {extras.mode} mode</p>
            <p className="font-mono">
              {snapshot
                ? `ticks ${snapshot.summary.ticks} · ${snapshot.summary.open_positions} positions`
                : "waiting for backend…"}
            </p>
          </footer>
        </main>
      </div>
    </div>
  );
}
