"use client";

import { Bell, Menu, Search } from "lucide-react";

export default function Topbar({
  live,
  lastMsg,
  selected,
  onSelect,
  symbols,
  onMenu,
}: {
  live: boolean;
  lastMsg: number;
  selected: string;
  onSelect: (s: string) => void;
  symbols: string[];
  onMenu: () => void;
}) {
  const clock = new Date().toLocaleTimeString("en-US", { hour12: false });
  return (
    <header className="sticky top-0 z-30 backdrop-blur-xl bg-ink-950/70 border-b border-white/[0.06]">
      <div className="px-4 sm:px-6 py-3 flex items-center gap-3">
        <button
          onClick={onMenu}
          className="lg:hidden w-9 h-9 grid place-items-center rounded-xl border border-white/10 text-slate-400 hover:bg-white/5"
          aria-label="Open menu"
        >
          <Menu className="w-4 h-4" />
        </button>

        <div className="hidden sm:flex items-center gap-2 h-9 px-3 rounded-xl bg-white/[0.05] border border-white/[0.07] focus-within:border-indigo-400/60 transition max-w-xs flex-1">
          <Search className="w-4 h-4 text-slate-500 shrink-0" />
          <input
            placeholder="Search symbol or order…"
            className="bg-transparent outline-none text-sm w-full placeholder:text-slate-500 text-slate-200"
          />
        </div>

        <div className="flex items-center gap-2 ml-auto">
          <div className="flex items-center gap-1 p-1 rounded-xl bg-white/[0.05] border border-white/[0.07] text-[12px] font-semibold">
            {symbols.map((s) => (
              <button
                key={s}
                onClick={() => onSelect(s)}
                className={`px-2.5 py-1.5 rounded-lg transition ${
                  selected === s
                    ? "bg-indigo-500 text-white shadow"
                    : "text-slate-400 hover:text-slate-200"
                }`}
              >
                {s}
              </button>
            ))}
          </div>

          <div
            className={`hidden sm:flex items-center gap-1.5 h-9 px-3 rounded-xl border text-[12px] font-semibold ${
              live
                ? "bg-emerald-500/10 border-emerald-500/20 text-emerald-400"
                : "bg-amber-500/10 border-amber-500/20 text-amber-400"
            }`}
            title={live ? "WebSocket connected" : "WebSocket offline — reconnecting"}
          >
            <span className={`w-1.5 h-1.5 rounded-full ${live ? "bg-emerald-400 animate-pulse" : "bg-amber-400"}`} />
            {live ? "LIVE" : "OFFLINE"}
          </div>

          <div className="hidden md:flex items-center h-9 px-3 rounded-xl border border-white/10 bg-white/[0.04] font-mono text-[12px] text-slate-400">
            {clock} UTC
          </div>

          <button className="relative w-9 h-9 grid place-items-center rounded-xl border border-white/10 bg-white/[0.04] text-slate-400 hover:text-indigo-400 transition">
            <Bell className="w-4 h-4" />
            <span className="absolute top-1.5 right-2 w-1.5 h-1.5 rounded-full bg-rose-500" />
          </button>

          <div className="w-9 h-9 rounded-xl bg-gradient-to-br from-indigo-500 to-fuchsia-600 grid place-items-center text-white text-[11px] font-bold">
            IM
          </div>
        </div>
      </div>
    </header>
  );
}
