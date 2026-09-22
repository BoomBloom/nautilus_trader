"use client";

import { useCallback, useEffect, useState } from "react";
import { Database, HardDrive, Link2, Radio } from "lucide-react";
import PriceChart from "@/components/PriceChart";
import EquityChart from "@/components/EquityChart";
import { FillsTable, OrdersTable, PositionsTable } from "@/components/Tables";
import OrderTicket from "@/components/OrderTicket";
import NodePanel from "@/components/NodePanel";
import { EventFeed, StrategyPanel } from "@/components/Panels";
import StatCard from "@/components/StatCard";
import { fmtDateTime, fmtMoney, fmtNum, fmtSigned } from "@/lib/format";
import {
  closePosition,
  getAdapters,
  getCatalog,
  getNodeStatus,
  getStrategies,
  listOrders,
  startSandbox,
} from "@/lib/api";
import type {
  AdapterInfo,
  CatalogResponse,
  Order,
  Snapshot,
  StreamExtrasLike,
} from "@/lib/types";

export function MarketsView({ snapshot }: { snapshot: Snapshot | null }) {
  const symbols = snapshot?.symbols ?? [];
  const fills = snapshot?.fills ?? [];
  return (
    <div className="space-y-5">
      <div className="grid grid-cols-1 lg:grid-cols-2 2xl:grid-cols-3 gap-5">
        {symbols.map((sym, i) => {
          const candles = snapshot?.candles?.[sym] ?? [];
          const first = candles[0]?.close ?? 0;
          const last = candles[candles.length - 1]?.close ?? 0;
          const change = first ? ((last - first) / first) * 100 : 0;
          return (
            <div key={sym} className="panel p-5 animate-fadeUp" style={{ animationDelay: `${i * 60}ms` }}>
              <div className="flex items-center justify-between mb-3">
                <div>
                  <h3 className="text-sm font-semibold text-white">{sym}</h3>
                  <p className="text-[12px] text-slate-500 mt-0.5 font-mono">
                    {fmtMoney(last)}{" "}
                    <span className={change >= 0 ? "text-emerald-400" : "text-rose-400"}>
                      {change >= 0 ? "+" : ""}
                      {change.toFixed(2)}%
                    </span>
                  </p>
                </div>
                <span className="text-[10px] font-bold uppercase px-2 py-1 rounded-md bg-indigo-500/15 text-indigo-300">
                  1m
                </span>
              </div>
              <PriceChart candles={candles} fills={fills.filter((f) => f.symbol === sym)} positions={[]} />
            </div>
          );
        })}
        {symbols.length === 0 && (
          <div className="panel p-8 text-center col-span-full">
            <p className="text-[13px] text-slate-500">Waiting for market data…</p>
          </div>
        )}
      </div>
    </div>
  );
}

export function PositionsView({ snapshot }: { snapshot: Snapshot | null }) {
  const s = snapshot?.summary;
  const positions = snapshot?.positions ?? [];
  const exposure = positions.reduce((a, p) => a + p.mark_price * p.qty, 0);
  const openPnl = positions.reduce((a, p) => a + p.unrealized_pnl, 0);

  return (
    <div className="space-y-5">
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <StatCard label="Open Positions" value={String(positions.length)} deltaLabel="live" accent="#6366f1" delay={40} />
        <StatCard label="Exposure" value={fmtMoney(exposure)} deltaLabel="notional" accent="#06b6d4" delay={90} />
        <StatCard
          label="Unrealized PnL"
          value={fmtSigned(openPnl)}
          deltaLabel={s ? `equity ${fmtMoney(s.equity)}` : ""}
          accent={openPnl >= 0 ? "#10b981" : "#f43f5e"}
          delay={140}
        />
      </div>
      <div className="flex justify-end">
        <button
          type="button"
          onClick={() => {
            closePosition().catch(() => {});
          }}
          className="text-[11px] font-bold uppercase px-2 py-1 rounded bg-amber-500/15 text-amber-400 hover:bg-amber-500/25 transition"
        >
          Close all
        </button>
      </div>
      <PositionsTable
        positions={positions}
        onClose={async (iid) => {
          try {
            await closePosition(iid);
          } catch {
            /* ignore */
          }
        }}
      />
      <div className="panel p-5">
        <h3 className="text-sm font-semibold text-white mb-1">Equity Curve</h3>
        <p className="text-[12px] text-slate-500 mb-3">Account value over the session</p>
        <EquityChart points={snapshot?.equity_curve ?? []} />
      </div>
    </div>
  );
}

export function OrdersView({
  snapshot,
  extras,
}: {
  snapshot: Snapshot | null;
  extras?: { mode: string; instruments: { id: string }[] };
}) {
  const snapshotOrders = snapshot?.orders ?? [];
  const fills = snapshot?.fills ?? [];
  const live = (extras?.mode || snapshot?.mode || "replay") === "live";
  const instrumentIds =
    extras?.instruments?.map((i) => i.id) ??
    snapshot?.instruments?.map((i) => i.id) ??
    [];

  const LIMIT = 50;
  const [apiOrders, setApiOrders] = useState<Order[] | null>(null);
  const [total, setTotal] = useState(0);
  const [offset, setOffset] = useState(0);
  const [apiOk, setApiOk] = useState(false);

  const fetchPage = useCallback(async (o: number) => {
    try {
      const d = await listOrders(LIMIT, o);
      setApiOrders(d.items);
      setTotal(d.total);
      setOffset(o);
      setApiOk(true);
    } catch {
      setApiOk(false);
    }
  }, []);

  const ordersLen = snapshotOrders.length;
  useEffect(() => {
    fetchPage(offset);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fetchPage, ordersLen]);

  const orders = apiOk && apiOrders !== null ? apiOrders : snapshotOrders;
  const page = apiOk ? { limit: LIMIT, offset, total, onPage: fetchPage } : null;

  return (
    <div className="space-y-5">
      <div className="grid grid-cols-1 xl:grid-cols-3 gap-5">
        <div className="xl:col-span-2 space-y-5">
          <OrdersTable orders={orders} onCancel={live} allowCancelAll={live} page={page} />
          <FillsTable fills={fills} />
        </div>
        <div>
          <OrderTicket
            instruments={instrumentIds}
            defaultInstrument={instrumentIds[0]}
            disabled={!live}
          />
        </div>
      </div>
    </div>
  );
}

export function StrategiesView({ snapshot }: { snapshot: Snapshot | null }) {
  const strategies = snapshot?.strategies ?? [];
  const total = strategies.reduce((a, s) => a + s.pnl, 0);
  const trades = strategies.reduce((a, s) => a + s.trades, 0);
  const [available, setAvailable] = useState<{ id: string; name: string; description: string }[]>([]);

  useEffect(() => {
    getStrategies()
      .then((d) =>
        setAvailable(
          (d.available || []).map((s) => ({
            id: String((s as any).id ?? ""),
            name: String((s as any).name ?? ""),
            description: String((s as any).description ?? ""),
          })),
        ),
      )
      .catch(() => {});
  }, []);

  return (
    <div className="space-y-5">
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <StatCard
          label="Running"
          value={`${strategies.filter((s) => s.status === "running").length}/${strategies.length}`}
          deltaLabel="agents"
          accent="#10b981"
          delay={40}
        />
        <StatCard label="Total Strategy PnL" value={fmtSigned(total)} deltaLabel="realized" accent="#6366f1" delay={90} />
        <StatCard label="Closed Trades" value={String(trades)} deltaLabel="this session" accent="#f59e0b" delay={140} />
      </div>
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
        <StrategyPanel strategies={strategies} />
        <div className="panel p-5">
          <h3 className="text-sm font-semibold text-white mb-3">Available strategies</h3>
          <div className="space-y-2">
            {available.length === 0 && (
              <p className="text-[13px] text-slate-500">Catalog unavailable — is the backend up?</p>
            )}
            {available.map((s) => (
              <div key={s.id} className="p-3 rounded-xl bg-white/[0.03] border border-white/[0.05]">
                <p className="text-[13px] font-semibold text-white">{s.name}</p>
                <p className="text-[12px] text-slate-500 mt-0.5 leading-relaxed">{s.description}</p>
                <p className="text-[11px] font-mono text-indigo-400 mt-1">{s.id}</p>
              </div>
            ))}
          </div>
          <p className="text-[12px] text-slate-600 mt-4 leading-relaxed">
            Run strategies from the Backtest view, or attach builtin EmaCross when starting the
            sandbox node.
          </p>
        </div>
      </div>
    </div>
  );
}

export function EventsView({ snapshot }: { snapshot: Snapshot | null }) {
  return (
    <div className="grid grid-cols-1 lg:grid-cols-3 gap-5">
      <div className="lg:col-span-2">
        <EventFeed events={snapshot?.events ?? []} full />
      </div>
      <div className="panel p-5 h-fit">
        <h3 className="text-sm font-semibold text-white mb-3">Session</h3>
        <dl className="space-y-3 text-[13px]">
          <div className="flex justify-between">
            <dt className="text-slate-500">Ticks processed</dt>
            <dd className="font-mono text-white">{snapshot ? fmtNum(snapshot.summary.ticks, 0) : "—"}</dd>
          </div>
          <div className="flex justify-between">
            <dt className="text-slate-500">Messages / sec</dt>
            <dd className="font-mono text-white">{snapshot?.summary.messages_per_sec ?? "—"}</dd>
          </div>
          <div className="flex justify-between">
            <dt className="text-slate-500">Latency</dt>
            <dd className="font-mono text-white">{snapshot?.summary.latency_ms ?? "—"} ms</dd>
          </div>
          <div className="flex justify-between">
            <dt className="text-slate-500">Events buffered</dt>
            <dd className="font-mono text-white">{snapshot?.events.length ?? 0}</dd>
          </div>
          <div className="flex justify-between">
            <dt className="text-slate-500">Mode</dt>
            <dd className="font-mono text-white">{snapshot?.mode || "replay"}</dd>
          </div>
        </dl>
      </div>
    </div>
  );
}

const STATUS_TONE: Record<string, string> = {
  ready: "text-emerald-400 bg-emerald-500/12",
  credentials_set: "text-cyan-400 bg-cyan-500/12",
  installed: "text-indigo-400 bg-indigo-500/12",
  missing_credentials: "text-amber-400 bg-amber-500/12",
  not_installed: "text-slate-400 bg-slate-500/12",
  unsupported: "text-rose-400 bg-rose-500/12",
};

export function IntegrationsView() {
  const [adapters, setAdapters] = useState<AdapterInfo[]>([]);
  const [catalog, setCatalog] = useState<CatalogResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [nodeRunning, setNodeRunning] = useState(false);
  const [actionMsg, setActionMsg] = useState<string | null>(null);

  useEffect(() => {
    Promise.all([getAdapters(), getCatalog(), getNodeStatus().catch(() => null)])
      .then(([a, c, n]) => {
        setAdapters(a);
        setCatalog(c);
        setNodeRunning(!!n?.running);
      })
      .catch((e) => setError(e instanceof Error ? e.message : "Failed to load"));
  }, []);

  const connectAdapter = async (a: AdapterInfo) => {
    if (nodeRunning) {
      setActionMsg(`${a.name}: node already running — stop it first to switch adapters.`);
      return;
    }
    setBusyId(a.id);
    setActionMsg(null);
    try {
      const venue = a.id === "SANDBOX" ? "BINANCE" : a.id;
      const instrument =
        a.type === "traditional" || a.type === "data_provider"
          ? "AAPL.NASDAQ"
          : `BTCUSDT.${venue}`;
      await startSandbox({ adapter: a.id, instrument_id: instrument });
      setNodeRunning(true);
      setActionMsg(`${a.name}: sandbox node started with ${instrument}.`);
    } catch (e) {
      setActionMsg(`${a.name}: ${e instanceof Error ? e.message : "start failed"}`);
    } finally {
      setBusyId(null);
    }
  };

  const storageCards = [
    {
      name: "GUI data dir",
      icon: HardDrive,
      status: catalog ? "ready" : "…",
      desc: catalog?.gui_data_dir || "backend/data",
      tone: "text-emerald-400 bg-emerald-500/12",
    },
    {
      name: "Repo test_data",
      icon: Database,
      status: catalog?.test_data_dir ? "ready" : "missing",
      desc: catalog?.test_data_dir || "test_data/ not found",
      tone: catalog?.test_data_dir ? "text-emerald-400 bg-emerald-500/12" : "text-amber-400 bg-amber-500/12",
    },
    {
      name: "NAUTILUS_PATH catalog",
      icon: Radio,
      status: catalog?.catalogs?.[0]?.exists ? "ready" : "unset",
      desc: catalog?.catalogs?.[0]?.path || "Set NAUTILUS_PATH to enable",
      tone: catalog?.catalogs?.[0]?.exists
        ? "text-emerald-400 bg-emerald-500/12"
        : "text-slate-400 bg-slate-500/12",
    },
  ];

  return (
    <div className="space-y-6">
      {error && (
        <div className="panel p-4 text-[13px] text-rose-400 font-mono">{error}</div>
      )}

      <section>
        <div className="flex items-center justify-between mb-3">
          <h3 className="text-sm font-semibold text-white">Venue adapters</h3>
          {actionMsg && (
            <span className="text-[12px] font-mono text-slate-400 max-w-[50%] truncate">{actionMsg}</span>
          )}
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-5">
          {adapters.map((a, i) => (
            <div
              key={a.id}
              className="panel p-5 hover:border-indigo-500/30 transition animate-fadeUp"
              style={{ animationDelay: `${i * 30}ms` }}
            >
              <div className="flex items-start justify-between gap-3">
                <div className="flex items-center gap-3 min-w-0">
                  <span className="w-10 h-10 rounded-xl grid place-items-center bg-indigo-500/12 text-indigo-400 shrink-0">
                    <Link2 className="w-5 h-5" />
                  </span>
                  <div className="min-w-0">
                    <p className="text-sm font-semibold text-white truncate">{a.name}</p>
                    <span
                      className={`text-[10px] font-bold uppercase px-1.5 py-0.5 rounded ${
                        STATUS_TONE[a.status] || STATUS_TONE.not_installed
                      }`}
                    >
                      {a.status.replace(/_/g, " ")}
                    </span>
                  </div>
                </div>
                <span className="text-[10px] font-mono text-slate-500 shrink-0">{a.type}</span>
              </div>
              <div className="mt-3 flex flex-wrap gap-1.5">
                {a.data && (
                  <span className="text-[10px] font-bold uppercase px-1.5 py-0.5 rounded bg-cyan-500/12 text-cyan-300">
                    data
                  </span>
                )}
                {a.exec && (
                  <span className="text-[10px] font-bold uppercase px-1.5 py-0.5 rounded bg-violet-500/12 text-violet-300">
                    exec
                  </span>
                )}
                {a.environments.map((e) => (
                  <span
                    key={e}
                    className="text-[10px] font-bold uppercase px-1.5 py-0.5 rounded bg-white/[0.06] text-slate-400"
                  >
                    {e}
                  </span>
                ))}
              </div>
              {a.notes && <p className="text-[12px] text-slate-500 mt-2 leading-relaxed">{a.notes}</p>}
              <p className="text-[11px] font-mono text-slate-600 mt-2">
                creds {a.credentials_configured}/{a.credentials_required}
                {a.credential_env_names.length > 0 && (
                  <span className="text-slate-700"> · {a.credential_env_names.join(", ")}</span>
                )}
              </p>
              <div className="mt-3 flex justify-end">
                <button
                  type="button"
                  onClick={() => connectAdapter(a)}
                  disabled={
                    busyId !== null ||
                    nodeRunning ||
                    !a.supported ||
                    !a.installed ||
                    !a.data ||
                    a.status === "unsupported" ||
                    a.status === "not_installed"
                  }
                  className="inline-flex items-center gap-1.5 rounded-lg bg-indigo-500/15 text-indigo-300 hover:bg-indigo-500/25 disabled:opacity-40 disabled:cursor-not-allowed text-[11px] font-bold uppercase px-3 py-1.5 transition"
                >
                  {busyId === a.id ? "Starting…" : nodeRunning ? "Node running" : "Start with adapter"}
                </button>
              </div>
            </div>
          ))}
          {adapters.length === 0 && !error && (
            <div className="panel p-6 text-center text-[13px] text-slate-500 col-span-full">
              Loading adapters…
            </div>
          )}
        </div>
      </section>

      <section>
        <h3 className="text-sm font-semibold text-white mb-3">Data catalog</h3>
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-5 mb-5">
          {storageCards.map((it) => (
            <div key={it.name} className="panel p-5">
              <div className="flex items-center gap-3">
                <span className="w-10 h-10 rounded-xl grid place-items-center bg-indigo-500/12 text-indigo-400">
                  <it.icon className="w-5 h-5" />
                </span>
                <div>
                  <p className="text-sm font-semibold text-white">{it.name}</p>
                  <span className={`text-[10px] font-bold uppercase px-1.5 py-0.5 rounded ${it.tone}`}>
                    {it.status}
                  </span>
                </div>
              </div>
              <p className="text-[12px] font-mono text-slate-500 mt-3 break-all">{it.desc}</p>
            </div>
          ))}
        </div>

        <div className="panel overflow-hidden">
          <div className="flex items-center justify-between px-5 pt-4 pb-3">
            <h4 className="text-sm font-semibold text-white">Data files</h4>
            <span className="text-[11px] text-slate-500">{catalog?.files?.length ?? 0} files</span>
          </div>
          <div className="overflow-x-auto max-h-[420px] overflow-y-auto">
            <table className="w-full text-[13px] min-w-[560px]">
              <thead className="sticky top-0 bg-ink-900">
                <tr className="text-left text-[10px] uppercase tracking-wider text-slate-500 border-y border-white/[0.06]">
                  <th className="font-semibold px-5 py-2.5">Name</th>
                  <th className="font-semibold px-5 py-2.5">Kind</th>
                  <th className="font-semibold px-5 py-2.5">Source</th>
                  <th className="font-semibold px-5 py-2.5 text-right">Size</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-white/[0.04]">
                {catalog?.files?.length === 0 && (
                  <tr>
                    <td colSpan={4} className="px-5 py-6 text-center text-slate-500">
                      No data files found
                    </td>
                  </tr>
                )}
                {(catalog?.files || []).map((f) => (
                  <tr key={f.abs_path} className="hover:bg-white/[0.03] transition">
                    <td className="px-5 py-2.5 font-mono text-slate-300 text-[12px] break-all">{f.path}</td>
                    <td className="px-5 py-2.5 text-slate-400">{f.ext || f.kind}</td>
                    <td className="px-5 py-2.5 text-slate-500">{f.source}</td>
                    <td className="px-5 py-2.5 text-right font-mono text-slate-400">
                      {(f.size_bytes / 1024).toFixed(1)} KB
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </section>
    </div>
  );
}

export function SettingsView({
  live,
  snapshot,
  node,
  onNodeChanged,
}: {
  live: boolean;
  snapshot: Snapshot | null;
  node?: { mode: string; running: boolean; state: string; trader_id?: string | null; instrument_id?: string | null; error?: string | null } | null;
  onNodeChanged?: (n: any) => void;
}) {
  const mode = snapshot?.mode || node?.mode || "replay";
  const balances = snapshot?.account?.balances ?? [];

  return (
    <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
      <NodePanel node={node ?? null} onChanged={onNodeChanged} />

      <div className="space-y-5">
        <div className="panel p-5">
          <h3 className="text-sm font-semibold text-white mb-4">Connection</h3>
          <dl className="space-y-3 text-[13px]">
            <div className="flex justify-between gap-4">
              <dt className="text-slate-500">WebSocket</dt>
              <dd className="font-mono text-slate-200 break-all text-right">ws://127.0.0.1:8000/ws/stream</dd>
            </div>
            <div className="flex justify-between gap-4">
              <dt className="text-slate-500">REST API</dt>
              <dd className="font-mono text-slate-200">http://127.0.0.1:8000/api</dd>
            </div>
            <div className="flex justify-between">
              <dt className="text-slate-500">Status</dt>
              <dd>
                <span
                  className={`text-[11px] font-bold px-2 py-0.5 rounded ${
                    live ? "bg-emerald-500/15 text-emerald-400" : "bg-rose-500/15 text-rose-400"
                  }`}
                >
                  {live ? "CONNECTED" : "OFFLINE"}
                </span>
              </dd>
            </div>
            <div className="flex justify-between">
              <dt className="text-slate-500">Mode</dt>
              <dd className="text-slate-200 capitalize">{mode}</dd>
            </div>
          </dl>
        </div>

        <div className="panel p-5">
          <h3 className="text-sm font-semibold text-white mb-4">Session</h3>
          <dl className="space-y-3 text-[13px]">
            <div className="flex justify-between">
              <dt className="text-slate-500">Instruments</dt>
              <dd className="font-mono text-slate-200 break-all text-right">
                {snapshot?.instruments?.map((i) => i.id).join(", ") || snapshot?.symbols.join(", ") || "—"}
              </dd>
            </div>
            <div className="flex justify-between">
              <dt className="text-slate-500">Ticks</dt>
              <dd className="font-mono text-slate-200">{snapshot ? fmtNum(snapshot.summary.ticks, 0) : "—"}</dd>
            </div>
            <div className="flex justify-between">
              <dt className="text-slate-500">Equity</dt>
              <dd className="font-mono text-slate-200">
                {snapshot ? fmtMoney(snapshot.summary.equity) : "—"}
              </dd>
            </div>
            <div className="flex justify-between">
              <dt className="text-slate-500">Stream interval</dt>
              <dd className="font-mono text-slate-200">500 ms</dd>
            </div>
          </dl>

          {balances.length > 0 && (
            <div className="mt-4 pt-4 border-t border-white/[0.06]">
              <p className="text-[11px] font-semibold uppercase tracking-wider text-slate-500 mb-2">
                Balances
              </p>
              <div className="space-y-1.5">
                {balances.map((b) => (
                  <div key={b.currency} className="flex justify-between text-[13px] font-mono">
                    <span className="text-slate-400">{b.currency}</span>
                    <span className="text-white">
                      {fmtNum(b.free, 4)} free · {fmtNum(b.locked, 4)} locked
                    </span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
