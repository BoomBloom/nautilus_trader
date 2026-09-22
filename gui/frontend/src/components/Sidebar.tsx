"use client";

import { X } from "lucide-react";
import { NAV, type ViewId } from "@/lib/nav";

export default function Sidebar({
  active,
  onNavigate,
  embedded = false,
  onClose,
}: {
  active: ViewId;
  onNavigate: (id: ViewId) => void;
  embedded?: boolean;
  onClose?: () => void;
}) {
  const groups: Array<"Main" | "Workspace"> = ["Main", "Workspace"];

  return (
    <aside
      className={`${
        embedded ? "flex w-full" : "hidden lg:flex w-[16rem]"
      } shrink-0 flex-col border-r border-white/[0.06] bg-ink-900 h-full`}
    >
      <div className="px-5 pt-6 pb-5 flex items-center gap-3">
        <div className="relative">
          <div className="absolute -inset-1 rounded-2xl bg-gradient-to-br from-indigo-500 via-violet-500 to-cyan-400 opacity-70 blur" />
          <div className="relative w-10 h-10 rounded-2xl bg-gradient-to-br from-indigo-500 to-cyan-500 grid place-items-center text-white shadow-lg shadow-indigo-600/30">
            <span className="text-lg font-black leading-none">N</span>
          </div>
        </div>
        <div className="leading-tight">
          <p className="font-bold text-white tracking-tight">Nautilus GUI</p>
          <p className="text-[11px] text-slate-500">Live Monitor</p>
        </div>
        {embedded && onClose && (
          <button
            onClick={onClose}
            className="ml-auto w-8 h-8 grid place-items-center rounded-lg text-slate-400 hover:bg-white/5"
            aria-label="Close menu"
          >
            <X className="w-4 h-4" />
          </button>
        )}
      </div>

      <nav className="flex-1 px-3 space-y-5 overflow-y-auto">
        {groups.map((group) => {
          const items = NAV.filter((n) => n.group === group);
          if (!items.length) return null;
          return (
            <div key={group}>
              <p className="px-3 mb-2 text-[10px] font-semibold tracking-[0.14em] uppercase text-slate-600">
                {group}
              </p>
              <div className="space-y-1">
                {items.map((item) => {
                  const isActive = active === item.id;
                  return (
                    <button
                      key={item.id}
                      type="button"
                      onClick={() => onNavigate(item.id)}
                      aria-current={isActive ? "page" : undefined}
                      className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm font-medium transition text-left ${
                        isActive
                          ? "bg-gradient-to-r from-indigo-500/18 to-transparent text-indigo-300"
                          : "text-slate-400 hover:bg-white/[0.04] hover:text-slate-200"
                      }`}
                    >
                      <span
                        className={`w-8 h-8 grid place-items-center rounded-lg transition ${
                          isActive
                            ? "bg-indigo-500/25 text-indigo-200 shadow-[0_0_22px_-6px_rgba(129,140,248,.9)]"
                            : "bg-white/[0.05] text-slate-500"
                        }`}
                      >
                        <item.icon className="w-4 h-4" />
                      </span>
                      {item.label}
                      {isActive && <span className="ml-auto w-1.5 h-1.5 rounded-full bg-indigo-400" />}
                    </button>
                  );
                })}
              </div>
            </div>
          );
        })}
      </nav>

      <div className="p-3">
        <div className="rounded-2xl p-[1px] bg-gradient-to-br from-indigo-500/70 via-fuchsia-500/40 to-cyan-400/60">
          <div className="rounded-2xl bg-ink-800 p-4">
            <p className="text-[13px] font-semibold text-white">Sandbox ready</p>
            <p className="text-[11px] text-slate-400 mt-0.5 mb-3">
              Backtest offline · start the sandbox node from Settings for live orders.
            </p>
            <div className="h-1.5 rounded-full bg-white/10 overflow-hidden">
              <div className="h-full w-1/2 rounded-full bg-gradient-to-r from-indigo-500 to-fuchsia-500" />
            </div>
          </div>
        </div>
      </div>
    </aside>
  );
}
