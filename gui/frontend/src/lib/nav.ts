import type { LucideIcon } from "lucide-react";
import { Activity, BarChart3, BookOpen, FlaskConical, Gauge, LayoutDashboard, Plug, Settings, Wallet } from "lucide-react";

export type ViewId =
  | "monitor"
  | "backtest"
  | "markets"
  | "positions"
  | "orders"
  | "strategies"
  | "events"
  | "integrations"
  | "settings";

export type NavItem = {
  id: ViewId;
  label: string;
  icon: LucideIcon;
  group: "Main" | "Workspace";
};

export const NAV: NavItem[] = [
  { id: "monitor", label: "Monitor", icon: LayoutDashboard, group: "Main" },
  { id: "backtest", label: "Backtest", icon: FlaskConical, group: "Main" },
  { id: "markets", label: "Markets", icon: BarChart3, group: "Main" },
  { id: "positions", label: "Positions", icon: Wallet, group: "Main" },
  { id: "orders", label: "Orders", icon: BookOpen, group: "Main" },
  { id: "strategies", label: "Strategies", icon: Gauge, group: "Main" },
  { id: "events", label: "Events", icon: Activity, group: "Main" },
  { id: "integrations", label: "Integrations", icon: Plug, group: "Workspace" },
  { id: "settings", label: "Settings", icon: Settings, group: "Workspace" },
];

export const VIEW_META: Record<ViewId, { title: string; subtitle: string; kicker: string }> = {
  monitor: {
    kicker: "Live monitor",
    title: "Trading Overview",
    subtitle: "Replay stream from local NautilusTrader backtest artifacts",
  },
  backtest: {
    kicker: "Engine",
    title: "Backtest",
    subtitle: "Run the embedded NautilusTrader BacktestEngine with the GUI bridge strategy",
  },
  markets: {
    kicker: "Markets",
    title: "Price Charts",
    subtitle: "Streaming candles for every tracked instrument",
  },
  positions: {
    kicker: "Portfolio",
    title: "Positions",
    subtitle: "Open exposure and unrealized performance",
  },
  orders: {
    kicker: "Execution",
    title: "Orders & Fills",
    subtitle: "Order log, fills, and the live order ticket",
  },
  strategies: {
    kicker: "Automation",
    title: "Strategies",
    subtitle: "Running agents, signals and realized PnL",
  },
  events: {
    kicker: "System",
    title: "Event Feed",
    subtitle: "Every engine and strategy event in real time",
  },
  integrations: {
    kicker: "Workspace",
    title: "Integrations",
    subtitle: "Venue adapters, data catalog, and storage backends",
  },
  settings: {
    kicker: "Workspace",
    title: "Settings",
    subtitle: "Sandbox node control, connection, and session state",
  },
};
