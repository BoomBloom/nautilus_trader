export function fmtMoney(v: number, digits = 2): string {
  const sign = v < 0 ? "-" : "";
  return (
    sign +
    "$" +
    Math.abs(v).toLocaleString("en-US", {
      minimumFractionDigits: digits,
      maximumFractionDigits: digits,
    })
  );
}

export function fmtSigned(v: number, digits = 2): string {
  const s = v > 0 ? "+" : "";
  return s + fmtMoney(v, digits);
}

export function fmtNum(v: number, digits = 2): string {
  return v.toLocaleString("en-US", {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  });
}

export function fmtTime(ts: number): string {
  return new Date(ts * 1000).toLocaleTimeString("en-US", {
    hour12: false,
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
}

export function fmtDateTime(ts: number): string {
  return new Date(ts * 1000).toLocaleString("en-US", {
    month: "short",
    day: "numeric",
    hour12: false,
    hour: "2-digit",
    minute: "2-digit",
  });
}
