"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { emitOrderAck } from "./orderAcks";
import type { AccountState, InstrumentInfo, NodeStatus, Snapshot } from "./types";

const GUI_TOKEN = process.env.NEXT_PUBLIC_GUI_TOKEN || "";
const WS_URL =
  "ws://127.0.0.1:8000/ws/stream" + (GUI_TOKEN ? `?token=${encodeURIComponent(GUI_TOKEN)}` : "");
const API = "/api/snapshot";

export type StreamExtras = {
  mode: string;
  node: NodeStatus | null;
  account: AccountState | null;
  instruments: InstrumentInfo[];
};

const DEFAULT_EXTRAS: StreamExtras = {
  mode: "replay",
  node: null,
  account: null,
  instruments: [],
};

export function useStream() {
  const [snapshot, setSnapshot] = useState<Snapshot | null>(null);
  const [extras, setExtras] = useState<StreamExtras>(DEFAULT_EXTRAS);
  const [live, setLive] = useState(false);
  const [lastMsg, setLastMsg] = useState(0);
  const [selected, setSelected] = useState("BTC/USD");
  const skipRef = useRef(0);

  const applyMessage = useCallback((msg: any) => {
    setLastMsg(Date.now());
    if (msg?.type === "mode") {
      setExtras((prev) => ({ ...prev, mode: String(msg.mode || "replay") }));
      return;
    }
    if (msg?.type === "node") {
      setExtras((prev) => ({ ...prev, node: msg.node as NodeStatus }));
      return;
    }
    if (msg?.type === "account") {
      setExtras((prev) => ({ ...prev, account: msg.account as AccountState }));
      setSnapshot((prev) => (prev ? { ...prev, account: msg.account } : prev));
      return;
    }
    if (msg?.type === "instruments") {
      const list = (msg.instruments || []) as InstrumentInfo[];
      setExtras((prev) => ({ ...prev, instruments: list }));
      setSnapshot((prev) => (prev ? { ...prev, instruments: list } : prev));
      return;
    }
    if (msg?.type === "order_ack" || msg?.type === "order_reject") {
      emitOrderAck({
        command_id: String(msg.command_id || ""),
        status: msg.type === "order_ack" ? "accepted" : "rejected",
        order_id: msg.order_id ? String(msg.order_id) : undefined,
        action: msg.action ? String(msg.action) : undefined,
        reason: msg.reason ? String(msg.reason) : undefined,
      });
      return;
    }
    setSnapshot((prev) => {
      if (!prev) {
        if (msg.type === "snapshot") return msg as Snapshot;
        return prev;
      }
      if (msg.type === "snapshot") return msg as Snapshot;
      const next: Snapshot = { ...prev };
      switch (msg.type) {
        case "summary":
          next.summary = msg.summary;
          break;
        case "candle":
        case "candle_update": {
          const list = [...(prev.candles[msg.symbol] || [])];
          const last = list[list.length - 1];
          if (last && last.time === msg.candle.time) {
            list[list.length - 1] = msg.candle;
          } else {
            list.push(msg.candle);
            if (list.length > 240) list.splice(0, list.length - 240);
          }
          next.candles = { ...prev.candles, [msg.symbol]: list };
          break;
        }
        case "equity":
          next.equity_curve = [...prev.equity_curve.slice(-399), msg.point];
          break;
        case "positions":
          next.positions = msg.positions;
          break;
        case "fill":
          next.fills = [msg.fill, ...prev.fills].slice(0, 15);
          break;
        case "order":
          next.orders = [msg.order, ...prev.orders].slice(0, 24);
          break;
        case "orders":
          next.orders = (msg.orders || []) as Snapshot["orders"];
          break;
        case "event":
          next.events = [msg.event, ...prev.events].slice(0, 30);
          break;
        case "position_closed":
          next.positions = prev.positions.filter((p) => p.id !== msg.position.id);
          break;
        case "mode":
          next.mode = String(msg.mode || "replay");
          break;
        case "account":
          next.account = msg.account;
          break;
        case "instruments":
          next.instruments = msg.instruments;
          break;
        default:
          return prev;
      }
      if (msg.type === "snapshot") return msg as Snapshot;
      return next;
    });
    if (msg?.mode) {
      setExtras((prev) => ({ ...prev, mode: String(msg.mode) }));
    }
  }, []);

  useEffect(() => {
    let ws: WebSocket | null = null;
    let closed = false;
    let retry: ReturnType<typeof setTimeout>;

    const connect = async () => {
      try {
        const res = await fetch(API);
        if (res.ok) {
          const data: Snapshot = await res.json();
          setSnapshot(data);
          setLastMsg(Date.now());
          if (data.mode) setExtras((p) => ({ ...p, mode: data.mode! }));
          if (data.account) setExtras((p) => ({ ...p, account: data.account! }));
          if (data.instruments) setExtras((p) => ({ ...p, instruments: data.instruments! }));
        }
      } catch {
        /* backend offline; UI keeps empty state */
      }
      try {
        ws = new WebSocket(WS_URL);
        ws.onopen = () => !closed && setLive(true);
        ws.onmessage = (e) => applyMessage(JSON.parse(e.data));
        ws.onclose = () => {
          setLive(false);
          if (!closed) retry = setTimeout(connect, 1500);
        };
        ws.onerror = () => ws?.close();
      } catch {
        if (!closed) retry = setTimeout(connect, 2000);
      }
    };

    connect();
    return () => {
      closed = true;
      clearTimeout(retry);
      ws?.close();
    };
  }, [applyMessage]);

  const candles = snapshot?.candles?.[selected] ?? [];
  const lastClose = candles.length ? candles[candles.length - 1].close : 0;

  return {
    snapshot,
    extras,
    live,
    lastMsg,
    selected,
    setSelected,
    candles,
    lastClose,
  };
}
