"use client";

import { useEffect, useState } from "react";
import { Loader2, Zap } from "lucide-react";
import { submitOrder } from "@/lib/api";
import { onOrderAck } from "@/lib/orderAcks";
import type { OrderTicketPayload } from "@/lib/types";

const SIDES = ["buy", "sell"] as const;
const TYPES = ["MARKET", "LIMIT", "STOP_MARKET", "STOP_LIMIT"] as const;
const TIFS = ["GTC", "IOC", "FOK", "GTD", "DAY"] as const;

export default function OrderTicket({
  instruments,
  defaultInstrument,
  disabled = false,
  onSubmitted,
}: {
  instruments: string[];
  defaultInstrument?: string;
  disabled?: boolean;
  onSubmitted?: () => void;
}) {
  const [instrumentId, setInstrumentId] = useState(
    defaultInstrument || instruments[0] || "BTCUSDT.BINANCE",
  );
  const [side, setSide] = useState<(typeof SIDES)[number]>("buy");
  const [type, setType] = useState<(typeof TYPES)[number]>("MARKET");
  const [qty, setQty] = useState("0.001");
  const [price, setPrice] = useState("");
  const [triggerPrice, setTriggerPrice] = useState("");
  const [tif, setTif] = useState<(typeof TIFS)[number]>("GTC");
  const [expiresAt, setExpiresAt] = useState("");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [pendingCmd, setPendingCmd] = useState<string | null>(null);

  useEffect(() => {
    if (!pendingCmd) return;
    return onOrderAck((ack) => {
      if (ack.command_id !== pendingCmd) return;
      setPendingCmd(null);
      if (ack.status === "accepted") {
        setMsg({ ok: true, text: `Accepted${ack.order_id ? ` · ${ack.order_id}` : ""}` });
      } else {
        setMsg({ ok: false, text: `Rejected: ${ack.reason || "unknown"}` });
      }
    });
  }, [pendingCmd]);

  const needsPrice = type === "LIMIT" || type === "STOP_LIMIT";
  const needsTrigger = type === "STOP_MARKET" || type === "STOP_LIMIT";
  const needsExpiry = tif === "GTD" || tif === "DAY";

  const submit = async () => {
    setBusy(true);
    setMsg(null);
    try {
      const payload: OrderTicketPayload = {
        instrument_id: instrumentId,
        side,
        type,
        qty,
        price: needsPrice ? price : null,
        trigger_price: needsTrigger ? triggerPrice : null,
        tif,
        expires_at: needsExpiry && expiresAt ? new Date(expiresAt).toISOString() : null,
      };
      const res = await submitOrder(payload);
      const cmdId = (res as { command_id?: string }).command_id;
      if (cmdId) {
        setPendingCmd(cmdId);
        setMsg({ ok: true, text: `Queued · waiting for ack (${cmdId})` });
      } else {
        setMsg({ ok: true, text: `Queued (${res.status})` });
      }
      onSubmitted?.();
    } catch (e) {
      setMsg({ ok: false, text: e instanceof Error ? e.message : "Order failed" });
    } finally {
      setBusy(false);
    }
  };

  const inputCls =
    "w-full rounded-lg bg-white/[0.04] border border-white/[0.08] px-3 py-2 text-[13px] font-mono text-white outline-none focus:border-indigo-500/60 transition";
  const labelCls =
    "block text-[11px] font-semibold uppercase tracking-wider text-slate-500 mb-1.5";

  return (
    <div className="panel p-5">
      <div className="flex items-center justify-between mb-4">
        <h3 className="text-sm font-semibold text-white flex items-center gap-2">
          <Zap className="w-4 h-4 text-indigo-400" />
          Order ticket
        </h3>
        <span
          className={`text-[10px] font-bold uppercase px-2 py-0.5 rounded ${
            disabled ? "bg-amber-500/15 text-amber-400" : "bg-emerald-500/15 text-emerald-400"
          }`}
        >
          {disabled ? "Live node required" : "Sandbox live"}
        </span>
      </div>

      <div className="grid grid-cols-2 gap-3">
        <label className="block col-span-2">
          <span className={labelCls}>Instrument</span>
          <select
            value={instrumentId}
            onChange={(e) => setInstrumentId(e.target.value)}
            className={inputCls}
          >
            {(instruments.length ? instruments : [instrumentId]).map((i) => (
              <option key={i} value={i} className="bg-slate-900">
                {i}
              </option>
            ))}
          </select>
        </label>

        <div>
          <span className={labelCls}>Side</span>
          <div className="flex gap-1 p-1 rounded-lg bg-white/[0.04] border border-white/[0.08]">
            {SIDES.map((s) => (
              <button
                key={s}
                type="button"
                onClick={() => setSide(s)}
                className={`flex-1 py-1.5 rounded-md text-[12px] font-bold uppercase transition ${
                  side === s
                    ? s === "buy"
                      ? "bg-emerald-500 text-white"
                      : "bg-rose-500 text-white"
                    : "text-slate-400 hover:text-slate-200"
                }`}
              >
                {s}
              </button>
            ))}
          </div>
        </div>

        <label className="block">
          <span className={labelCls}>Type</span>
          <select value={type} onChange={(e) => setType(e.target.value as any)} className={inputCls}>
            {TYPES.map((t) => (
              <option key={t} value={t} className="bg-slate-900">
                {t}
              </option>
            ))}
          </select>
        </label>

        <label className="block">
          <span className={labelCls}>Qty</span>
          <input value={qty} onChange={(e) => setQty(e.target.value)} className={inputCls} />
        </label>

        <label className="block">
          <span className={labelCls}>{needsPrice ? "Price" : "Price (optional)"}</span>
          <input
            value={price}
            onChange={(e) => setPrice(e.target.value)}
            placeholder={needsPrice ? "required" : "market"}
            className={inputCls}
          />
        </label>

        {needsTrigger && (
          <label className="block">
            <span className={labelCls}>Trigger price</span>
            <input
              value={triggerPrice}
              onChange={(e) => setTriggerPrice(e.target.value)}
              placeholder="required"
              className={inputCls}
            />
          </label>
        )}

        <label className="block">
          <span className={labelCls}>Time in force</span>
          <select value={tif} onChange={(e) => setTif(e.target.value as any)} className={inputCls}>
            {TIFS.map((t) => (
              <option key={t} value={t} className="bg-slate-900">
                {t}
              </option>
            ))}
          </select>
        </label>

        {needsExpiry && (
          <label className="block col-span-2">
            <span className={labelCls}>Expires at</span>
            <input
              type="datetime-local"
              value={expiresAt}
              onChange={(e) => setExpiresAt(e.target.value)}
              className={inputCls}
            />
          </label>
        )}
      </div>

      <button
        onClick={submit}
        disabled={
          disabled ||
          busy ||
          !qty ||
          (needsPrice && !price) ||
          (needsTrigger && !triggerPrice) ||
          (needsExpiry && !expiresAt)
        }
        className="mt-4 w-full inline-flex items-center justify-center gap-2 rounded-xl bg-indigo-500 hover:bg-indigo-400 disabled:bg-indigo-500/40 disabled:cursor-not-allowed text-white text-[13px] font-semibold px-4 py-2.5 transition"
      >
        {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : null}
        {busy ? "Submitting…" : `Submit ${side.toUpperCase()} order`}
      </button>

      {msg && (
        <p
          className={`mt-2 text-[12.5px] font-mono break-all ${
            msg.ok ? "text-emerald-400" : "text-rose-400"
          }`}
        >
          {msg.text}
        </p>
      )}
      {disabled && (
        <p className="mt-2 text-[12px] text-slate-500">
          Start the sandbox node from Settings or Monitor to enable trading.
        </p>
      )}
    </div>
  );
}
