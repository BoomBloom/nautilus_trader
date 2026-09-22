"use client";

import { fmtSigned, fmtTime } from "@/lib/format";
import type { FeedEvent, Strategy } from "@/lib/types";

const toneMap: Record<string, string> = {
  info: "bg-slate-500/15 text-slate-400",
  ok: "bg-emerald-500/15 text-emerald-400",
  bad: "bg-rose-500/15 text-rose-400",
  warn: "bg-amber-500/15 text-amber-400",
};

export function StrategyPanel({ strategies }: { strategies: Strategy[] }) {
  return (
    <div className="panel p-5">
      <div className="flex items-center justify-between mb-4">
        <h3 className="text-sm font-semibold text-white">Strategies</h3>
        <span className="text-[11px] text-slate-500">
          {strategies.filter((s) => s.status === "running").length}/{strategies.length} running
        </span>
      </div>
      <div className="space-y-3">
        {strategies.map((s) => (
          <div
            key={s.name}
            className="p-3 rounded-xl border border-white/[0.06] bg-white/[0.02] hover:border-indigo-500/30 transition"
          >
            <div className="flex items-center justify-between gap-2">
              <p className="text-[13px] font-semibold text-white truncate">{s.name}</p>
              <span
                className={`text-[10px] font-bold uppercase px-1.5 py-0.5 rounded ${
                  s.status === "running" ? "bg-emerald-500/15 text-emerald-400" : "bg-slate-500/15 text-slate-400"
                }`}
              >
                {s.status}
              </span>
            </div>
            <div className="mt-2 flex items-center justify-between text-[12px]">
              <span className="text-slate-500 font-mono">
                {s.symbol} · EMA {s.ema_fast}/{s.ema_slow}
              </span>
              <span className={`font-mono font-semibold ${s.pnl >= 0 ? "text-emerald-400" : "text-rose-400"}`}>
                {fmtSigned(s.pnl)}
              </span>
            </div>
            <div className="mt-1.5 text-[11px] text-slate-500">{s.trades} closed trades</div>
          </div>
        ))}
      </div>
    </div>
  );
}

export function EventFeed({ events, full = false }: { events: FeedEvent[]; full?: boolean }) {
  return (
    <div className="panel p-5 h-full">
      <div className="flex items-center justify-between mb-3">
        <h3 className="text-sm font-semibold text-white">Event Feed</h3>
        <span className="flex items-center gap-1.5 text-[11px] font-semibold text-emerald-400">
          <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" /> LIVE
        </span>
      </div>
      <div
        className={`space-y-2 overflow-y-auto pr-1 feed-scroll ${full ? "max-h-[600px]" : "max-h-[300px]"}`}
      >
        {events.length === 0 && <p className="text-[13px] text-slate-500 py-4 text-center">No events yet…</p>}
        {events.map((e) => (
          <div
            key={e.id + e.ts}
            className="flex items-start gap-2.5 p-2.5 rounded-xl bg-white/[0.02] border border-white/[0.04] hover:border-white/[0.08] transition animate-fadeUp"
          >
            <span className={`text-[9px] font-bold uppercase px-1.5 py-0.5 rounded shrink-0 mt-0.5 ${toneMap[e.tone]}`}>
              {e.type}
            </span>
            <div className="min-w-0">
              <p className="text-[12.5px] text-slate-300 leading-snug break-words">{e.text}</p>
              <p className="text-[10.5px] text-slate-600 mt-0.5 font-mono">{fmtTime(e.ts)}</p>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
