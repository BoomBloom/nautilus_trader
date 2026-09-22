"use client";

export default function StatCard({
  label,
  value,
  delta,
  deltaLabel,
  accent,
  delay = 0,
}: {
  label: string;
  value: string;
  delta?: number;
  deltaLabel?: string;
  accent: string;
  delay?: number;
}) {
  const up = (delta ?? 0) >= 0;
  return (
    <div
      className="stat-glow relative rounded-2xl overflow-hidden border border-white/[0.06] bg-ink-800 p-4 sm:p-5 animate-fadeUp"
      style={{ ["--c1" as string]: accent, animationDelay: `${delay}ms` }}
    >
      <p className="relative text-[11px] font-semibold uppercase tracking-wider text-slate-500">{label}</p>
      <p className="relative mt-1.5 text-[24px] font-bold tracking-tight text-white">{value}</p>
      <div className="relative mt-2.5 flex items-center gap-2">
        {delta !== undefined && (
          <span
            className={`inline-flex items-center gap-1 text-[11px] font-semibold px-2 py-0.5 rounded-md ${
              up ? "text-emerald-400 bg-emerald-500/10" : "text-rose-400 bg-rose-500/10"
            }`}
          >
            <span>{up ? "▲" : "▼"}</span>
            {Math.abs(delta).toFixed(2)}%
          </span>
        )}
        {deltaLabel && <span className="text-[11px] text-slate-500">{deltaLabel}</span>}
      </div>
    </div>
  );
}
