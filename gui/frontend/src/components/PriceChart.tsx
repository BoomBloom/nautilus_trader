"use client";

import { useEffect, useRef } from "react";
import {
  ColorType,
  createChart,
  CrosshairMode,
  IChartApi,
  ISeriesApi,
  UTCTimestamp,
} from "lightweight-charts";
import type { Candle, Fill, Position } from "@/lib/types";

export default function PriceChart({
  candles,
  fills,
  positions,
}: {
  candles: Candle[];
  fills: Fill[];
  positions: Position[];
}) {
  const boxRef = useRef<HTMLDivElement>(null);
  const chartRef = useRef<IChartApi | null>(null);
  const seriesRef = useRef<ISeriesApi<"Candlestick"> | null>(null);
  const volRef = useRef<ISeriesApi<"Histogram"> | null>(null);
  const ready = useRef(false);

  useEffect(() => {
    if (!boxRef.current) return;
    const chart = createChart(boxRef.current, {
      autoSize: true,
      layout: {
        background: { type: ColorType.Solid, color: "transparent" },
        textColor: "#64748b",
        fontSize: 11,
      },
      grid: {
        vertLines: { color: "rgba(148,163,184,0.06)" },
        horzLines: { color: "rgba(148,163,184,0.06)" },
      },
      crosshair: { mode: CrosshairMode.Normal },
      rightPriceScale: { borderColor: "rgba(148,163,184,0.12)" },
      timeScale: { borderColor: "rgba(148,163,184,0.12)", timeVisible: true, secondsVisible: false },
    });
    const series = chart.addCandlestickSeries({
      upColor: "#34d399",
      downColor: "#fb7185",
      borderUpColor: "#34d399",
      borderDownColor: "#fb7185",
      wickUpColor: "#34d399",
      wickDownColor: "#fb7185",
      priceLineColor: "#818cf8",
    });
    const vol = chart.addHistogramSeries({
      priceFormat: { type: "volume" },
      priceScaleId: "vol",
    });
    chart.priceScale("vol").applyOptions({ scaleMargins: { top: 0.82, bottom: 0 } });
    chartRef.current = chart;
    seriesRef.current = series;
    volRef.current = vol;
    ready.current = true;
    return () => {
      chart.remove();
      chartRef.current = null;
      seriesRef.current = null;
      volRef.current = null;
      ready.current = false;
    };
  }, []);

  useEffect(() => {
    if (!ready.current || !seriesRef.current || !volRef.current || !candles.length) return;
    seriesRef.current.setData(
      candles.map((c) => ({
        time: c.time as UTCTimestamp,
        open: c.open,
        high: c.high,
        low: c.low,
        close: c.close,
      }))
    );
    volRef.current.setData(
      candles.map((c) => ({
        time: c.time as UTCTimestamp,
        value: c.volume,
        color: c.close >= c.open ? "rgba(52,211,153,.35)" : "rgba(251,113,133,.35)",
      }))
    );

    const closed = new Set<number>();
    const markers = fills
      .filter((f) => {
        if (closed.has(f.ts)) return false;
        closed.add(f.ts);
        return true;
      })
      .map((f) => ({
        time: f.ts as UTCTimestamp,
        position: (f.side === "short" || f.side === "close" ? "aboveBar" : "belowBar") as
          | "aboveBar"
          | "belowBar",
        color: f.side === "short" || f.side === "close" ? "#fb7185" : "#34d399",
        shape: (f.side === "short" || f.side === "close" ? "arrowDown" : "arrowUp") as
          | "arrowDown"
          | "arrowUp",
        text: `${f.side.toUpperCase()} @ ${f.price.toFixed(0)}`,
      }))
      .sort((a, b) => a.time - b.time);

    seriesRef.current.setMarkers(markers);
    chartRef.current?.timeScale().scrollToRealTime();
  }, [candles, fills, positions]);

  return (
    <div ref={boxRef} className="h-[300px] sm:h-[340px] w-full" />
  );
}
