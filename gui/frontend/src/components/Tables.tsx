"use client";

import { Fragment, useState } from "react";
import { cancelAllOrders, cancelOrder, modifyOrder } from "@/lib/api";
import { fmtMoney, fmtNum } from "@/lib/format";
import type { Fill, Order, Position } from "@/lib/types";

export function PositionsTable({
  positions,
  onClose,
}: {
  positions: Position[];
  onClose?: (instrumentId: string) => void;
}) {
  return (
    <div className="panel overflow-hidden">
      <div className="flex items-center justify-between px-5 pt-4 pb-3">
        <h3 className="text-sm font-semibold text-white">Open Positions</h3>
        <span className="text-[11px] font-semibold px-2 py-0.5 rounded-md bg-indigo-500/15 text-indigo-300">
          {positions.length} open
        </span>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full text-[13px] min-w-[520px]">
          <thead>
            <tr className="text-left text-[10px] uppercase tracking-wider text-slate-500 border-y border-white/[0.06]">
              <th className="font-semibold px-5 py-2.5">Symbol</th>
              <th className="font-semibold px-5 py-2.5">Side</th>
              <th className="font-semibold px-5 py-2.5 text-right">Qty</th>
              <th className="font-semibold px-5 py-2.5 text-right">Entry</th>
              <th className="font-semibold px-5 py-2.5 text-right">Mark</th>
              <th className="font-semibold px-5 py-2.5 text-right">uPnL</th>
              {onClose && <th className="font-semibold px-5 py-2.5 text-right">Actions</th>}
            </tr>
          </thead>
          <tbody className="divide-y divide-white/[0.04]">
            {positions.length === 0 && (
              <tr>
                <td
                  colSpan={onClose ? 7 : 6}
                  className="px-5 py-6 text-center text-slate-500 text-[13px]"
                >
                  No open positions — strategies are scanning…
                </td>
              </tr>
            )}
            {positions.map((p) => (
              <tr key={p.id} className="hover:bg-white/[0.03] transition">
                <td className="px-5 py-2.5 font-semibold text-white">{p.symbol}</td>
                <td className="px-5 py-2.5">
                  <span
                    className={`text-[11px] font-bold px-2 py-0.5 rounded ${
                      p.side === "long" ? "bg-emerald-500/15 text-emerald-400" : "bg-rose-500/15 text-rose-400"
                    }`}
                  >
                    {p.side.toUpperCase()}
                  </span>
                </td>
                <td className="px-5 py-2.5 text-right font-mono text-slate-300">{fmtNum(p.qty, 4)}</td>
                <td className="px-5 py-2.5 text-right font-mono text-slate-300">{fmtMoney(p.entry_price)}</td>
                <td className="px-5 py-2.5 text-right font-mono text-slate-300">{fmtMoney(p.mark_price)}</td>
                <td
                  className={`px-5 py-2.5 text-right font-mono font-semibold ${
                    p.unrealized_pnl >= 0 ? "text-emerald-400" : "text-rose-400"
                  }`}
                >
                  {p.unrealized_pnl >= 0 ? "+" : ""}
                  {fmtMoney(p.unrealized_pnl)}
                </td>
                {onClose && (
                  <td className="px-5 py-2.5 text-right">
                    <button
                      onClick={() => onClose(p.instrument_id ?? p.id)}
                      className="text-[11px] font-bold uppercase px-2 py-1 rounded bg-amber-500/15 text-amber-400 hover:bg-amber-500/25 transition"
                    >
                      Close
                    </button>
                  </td>
                )}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

export function FillsTable({ fills }: { fills: Fill[] }) {
  return (
    <div className="panel overflow-hidden">
      <div className="flex items-center justify-between px-5 pt-4 pb-3">
        <h3 className="text-sm font-semibold text-white">Recent Fills</h3>
        <span className="text-[11px] text-slate-500">streaming</span>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full text-[13px] min-w-[520px]">
          <thead>
            <tr className="text-left text-[10px] uppercase tracking-wider text-slate-500 border-y border-white/[0.06]">
              <th className="font-semibold px-5 py-2.5">Time</th>
              <th className="font-semibold px-5 py-2.5">Symbol</th>
              <th className="font-semibold px-5 py-2.5">Side</th>
              <th className="font-semibold px-5 py-2.5 text-right">Qty</th>
              <th className="font-semibold px-5 py-2.5 text-right">Price</th>
              <th className="font-semibold px-5 py-2.5">Strategy</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-white/[0.04]">
            {fills.length === 0 && (
              <tr>
                <td colSpan={6} className="px-5 py-6 text-center text-slate-500 text-[13px]">
                  Waiting for fills…
                </td>
              </tr>
            )}
            {fills.map((f) => (
              <tr key={f.id + f.ts} className="hover:bg-white/[0.03] transition">
                <td className="px-5 py-2.5 font-mono text-slate-500 text-[12px]">
                  {new Date(f.ts * 1000).toLocaleTimeString("en-US", { hour12: false })}
                </td>
                <td className="px-5 py-2.5 font-semibold text-white">{f.symbol}</td>
                <td className="px-5 py-2.5">
                  <span
                    className={`text-[11px] font-bold px-2 py-0.5 rounded ${
                      f.side === "short" || f.side === "close"
                        ? "bg-rose-500/15 text-rose-400"
                        : "bg-emerald-500/15 text-emerald-400"
                    }`}
                  >
                    {f.side.toUpperCase()}
                  </span>
                </td>
                <td className="px-5 py-2.5 text-right font-mono text-slate-300">{fmtNum(f.qty, 4)}</td>
                <td className="px-5 py-2.5 text-right font-mono text-slate-300">{fmtMoney(f.price)}</td>
                <td className="px-5 py-2.5 text-slate-400">{f.strategy}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

const OPEN_STATUSES = new Set(["INITIALIZED", "ACCEPTED", "PENDING_NEW", "PENDING_CANCEL", "PENDING_REPLACE"]);

export function OrdersTable({
  orders,
  onCancel = false,
  allowCancelAll = false,
  page = null,
  onModified = null,
}: {
  orders: Order[];
  onCancel?: boolean;
  allowCancelAll?: boolean;
  page?: { limit: number; offset: number; total: number; onPage: (o: number) => void } | null;
  onModified?: (() => void) | null;
}) {
  const [busyId, setBusyId] = useState<string | null>(null);
  const [allBusy, setAllBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [editId, setEditId] = useState<string | null>(null);
  const [editQty, setEditQty] = useState("");
  const [editPrice, setEditPrice] = useState("");
  const [modId, setModId] = useState<string | null>(null);

  const cancel = async (id: string) => {
    setBusyId(id);
    setErr(null);
    try {
      await cancelOrder(id);
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Cancel failed");
    } finally {
      setBusyId(null);
    }
  };

  const cancelAll = async () => {
    setAllBusy(true);
    setErr(null);
    try {
      await cancelAllOrders();
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Cancel all failed");
    } finally {
      setAllBusy(false);
    }
  };

  const startEdit = (o: Order) => {
    setEditId(o.id);
    setEditQty(String(o.qty ?? ""));
    setEditPrice(o.price != null ? String(o.price) : "");
    setErr(null);
  };

  const saveModify = async (o: Order) => {
    const isLimit = /LIMIT/.test(o.type || "");
    if (!editQty.trim()) {
      setErr("Qty is required to modify an order");
      return;
    }
    if (isLimit && !editPrice.trim()) {
      setErr("Price is required to modify a limit order");
      return;
    }
    setModId(o.id);
    setErr(null);
    try {
      await modifyOrder(o.id, {
        qty: editQty.trim(),
        ...(isLimit ? { price: editPrice.trim() } : {}),
      });
      setEditId(null);
      onModified?.();
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Modify failed");
    } finally {
      setModId(null);
    }
  };

  const colCount = (onCancel ? 10 : 9) + 1;
  const pageFrom = page ? page.offset + 1 : 0;
  const pageTo = page ? Math.min(page.offset + orders.length, page.total) : 0;

  return (
    <div className="panel overflow-hidden">
      <div className="flex items-center justify-between px-5 pt-4 pb-3">
        <div className="flex items-center gap-3">
          <h3 className="text-sm font-semibold text-white">Order Log</h3>
          {allowCancelAll && (
            <button
              onClick={cancelAll}
              disabled={!onCancel || allBusy}
              className="text-[11px] font-bold uppercase px-2 py-1 rounded bg-rose-500/15 text-rose-400 hover:bg-rose-500/25 disabled:opacity-30 disabled:cursor-not-allowed transition"
            >
              {allBusy ? "…" : "Cancel all"}
            </button>
          )}
        </div>
        <span className="text-[11px] text-slate-500">last {orders.length}</span>
      </div>
      {err && (
        <p className="px-5 pb-2 text-[12px] text-rose-400 font-mono break-all">{err}</p>
      )}
      <div className="overflow-x-auto">
        <table className="w-full text-[13px] min-w-[560px]">
          <thead>
            <tr className="text-left text-[10px] uppercase tracking-wider text-slate-500 border-y border-white/[0.06]">
              <th className="font-semibold px-5 py-2.5">ID</th>
              <th className="font-semibold px-5 py-2.5">Symbol</th>
              <th className="font-semibold px-5 py-2.5">Side</th>
              <th className="font-semibold px-5 py-2.5">Type</th>
              <th className="font-semibold px-5 py-2.5 text-right">Qty</th>
              <th className="font-semibold px-5 py-2.5 text-right">Price</th>
              <th className="font-semibold px-5 py-2.5 text-right">Avg px</th>
              <th className="font-semibold px-5 py-2.5 text-right">Fee</th>
              <th className="font-semibold px-5 py-2.5">TIF</th>
              <th className="font-semibold px-5 py-2.5">Status</th>
              {onCancel && <th className="font-semibold px-5 py-2.5 text-right">Actions</th>}
            </tr>
          </thead>
          <tbody className="divide-y divide-white/[0.04]">
            {orders.length === 0 && (
              <tr>
                <td colSpan={colCount} className="px-5 py-6 text-center text-slate-500 text-[13px]">
                  No orders yet
                </td>
              </tr>
            )}
            {orders.map((o) => {
              const canCancel = onCancel && OPEN_STATUSES.has((o.status || "").toUpperCase());
              const filled = o.filled_qty != null && o.filled_qty > 0;
              const isLimit = /LIMIT/.test(o.type || "");
              return (
                <Fragment key={o.id}>
                <tr className="hover:bg-white/[0.03] transition">
                  <td className="px-5 py-2.5 font-mono text-slate-500 text-[12px]">{o.id}</td>
                  <td className="px-5 py-2.5 font-semibold text-white">{o.symbol}</td>
                  <td className="px-5 py-2.5">
                    <span className={o.side === "long" || o.side === "buy" ? "text-emerald-400" : "text-rose-400"}>
                      {o.side.toUpperCase()}
                    </span>
                  </td>
                  <td className="px-5 py-2.5 text-slate-400">{o.type}</td>
                  <td className="px-5 py-2.5 text-right font-mono text-slate-300">
                    {o.filled_qty != null && o.filled_qty > 0
                      ? `${fmtNum(o.filled_qty, 4)} / ${fmtNum(o.qty, 4)}`
                      : fmtNum(o.qty, 4)}
                  </td>
                  <td className="px-5 py-2.5 text-right font-mono text-slate-300">{fmtMoney(o.price)}</td>
                  <td className="px-5 py-2.5 text-right font-mono text-slate-300">
                    {!o.avg_px && !filled ? "—" : fmtMoney(o.avg_px || 0)}
                  </td>
                  <td className="px-5 py-2.5 text-right font-mono text-slate-400">
                    {fmtNum(o.fee || 0, 6)}
                  </td>
                  <td className="px-5 py-2.5 text-slate-400">{o.tif || "—"}</td>
                  <td className="px-5 py-2.5">
                    <span className="text-[11px] font-bold px-2 py-0.5 rounded bg-indigo-500/15 text-indigo-300">
                      {o.status}
                    </span>
                  </td>
                  {onCancel && (
                    <td className="px-5 py-2.5 text-right whitespace-nowrap">
                      {editId !== o.id && (
                        <button
                          onClick={() => startEdit(o)}
                          disabled={!canCancel || busyId === o.id}
                          className="text-[11px] font-bold uppercase px-2 py-1 mr-1.5 rounded bg-indigo-500/15 text-indigo-300 hover:bg-indigo-500/25 disabled:opacity-30 disabled:cursor-not-allowed transition"
                        >
                          Modify
                        </button>
                      )}
                      <button
                        onClick={() => cancel(o.id)}
                        disabled={!canCancel || busyId === o.id || modId === o.id}
                        className="text-[11px] font-bold uppercase px-2 py-1 rounded bg-rose-500/15 text-rose-400 hover:bg-rose-500/25 disabled:opacity-30 disabled:cursor-not-allowed transition"
                      >
                        {busyId === o.id ? "…" : "Cancel"}
                      </button>
                    </td>
                  )}
                </tr>
                {editId === o.id && (
                  <tr className="bg-indigo-500/[0.05]">
                    <td colSpan={colCount} className="px-5 py-3">
                      <div className="flex flex-wrap items-center gap-3">
                        <span className="text-[10px] uppercase tracking-wider text-slate-500 font-semibold">
                          Modify {o.symbol} {o.id}
                        </span>
                        <label className="flex items-center gap-2 text-[12px] text-slate-400">
                          Qty
                          <input
                            value={editQty}
                            onChange={(e) => setEditQty(e.target.value)}
                            className="w-24 rounded bg-white/[0.06] border border-white/[0.08] px-2 py-1 text-[12px] text-white font-mono focus:outline-none focus:border-indigo-500/60"
                          />
                        </label>
                        {isLimit && (
                          <label className="flex items-center gap-2 text-[12px] text-slate-400">
                            Price
                            <input
                              value={editPrice}
                              onChange={(e) => setEditPrice(e.target.value)}
                              className="w-28 rounded bg-white/[0.06] border border-white/[0.08] px-2 py-1 text-[12px] text-white font-mono focus:outline-none focus:border-indigo-500/60"
                            />
                          </label>
                        )}
                        <button
                          onClick={() => saveModify(o)}
                          disabled={modId === o.id}
                          className="text-[11px] font-bold uppercase px-2 py-1 rounded bg-indigo-500/15 text-indigo-300 hover:bg-indigo-500/25 disabled:opacity-30 disabled:cursor-not-allowed transition"
                        >
                          {modId === o.id ? "…" : "Save"}
                        </button>
                        <button
                          onClick={() => setEditId(null)}
                          disabled={modId === o.id}
                          className="text-[11px] font-bold uppercase px-2 py-1 rounded bg-white/[0.06] text-slate-300 hover:bg-white/[0.1] disabled:opacity-30 disabled:cursor-not-allowed transition"
                        >
                          Discard
                        </button>
                      </div>
                    </td>
                  </tr>
                )}
                </Fragment>
              );
            })}
          </tbody>
        </table>
      </div>
      {page && page.total > 0 && (
        <div className="flex items-center justify-between px-5 py-3 border-t border-white/[0.06]">
          <span className="text-[11px] text-slate-500">
            Showing {pageFrom}–{pageTo} of {page.total}
          </span>
          <div className="flex items-center gap-2">
            <button
              onClick={() => page.onPage(Math.max(0, page.offset - page.limit))}
              disabled={page.offset <= 0}
              className="text-[11px] font-bold uppercase px-2 py-1 rounded bg-white/[0.06] text-slate-300 hover:bg-white/[0.1] disabled:opacity-30 disabled:cursor-not-allowed transition"
            >
              Prev
            </button>
            <button
              onClick={() => page.onPage(page.offset + page.limit)}
              disabled={page.offset + page.limit >= page.total}
              className="text-[11px] font-bold uppercase px-2 py-1 rounded bg-white/[0.06] text-slate-300 hover:bg-white/[0.1] disabled:opacity-30 disabled:cursor-not-allowed transition"
            >
              Next
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
