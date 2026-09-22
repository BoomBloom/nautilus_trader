"use client";

import { useEffect, useRef } from "react";
import {
  ColorType,
  createChart,
  IChartApi,
  ISeriesApi,
  UTCTimestamp,
} from "lightweight-charts";
import type { EquityPoint } from "@/lib/types";

export default function EquityChart({ points }: { points: EquityPoint[] }) {
  const boxRef = useRef<HTMLDivElement>(null);
  const chartRef = useRef<IChartApi | null>(null);
  const seriesRef = useRef<ISeriesApi<"Area"> | null>(null);
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
        vertLines: { color: "rgba(148,163,184,0.05)" },
        horzLines: { color: "rgba(148,163,184,0.05)" },
      },
      rightPriceScale: { borderColor: "rgba(148,163,184,0.12)" },
      timeScale: { borderColor: "rgba(148,163,184,0.12)", timeVisible: true },
    });
    const series = chart.addAreaSeries({
      lineColor: "#818cf8",
      topColor: "rgba(129,140,248,0.35)",
      bottomColor: "rgba(129,140,248,0.02)",
      lineWidth: 2,
      priceLineColor: "#818cf8",
    });
    chartRef.current = chart;
    seriesRef.current = series;
    ready.current = true;
    return () => {
      chart.remove();
      chartRef.current = null;
      seriesRef.current = null;
      ready.current = false;
    };
  }, []);

  useEffect(() => {
    if (!ready.current || !seriesRef.current || !points.length) return;
    const seen = new Set<number>();
    const data = points
      .filter((p) => (seen.has(p.time) ? false : (seen.add(p.time), true)))
      .map((p) => ({ time: p.time as UTCTimestamp, value: p.equity }))
      .sort((a, b) => (a.time as number) - (b.time as number));
    seriesRef.current.setData(data);
  }, [points]);

  return <div ref={boxRef} className="h-[180px] w-full" />;
}
