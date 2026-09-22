# Local backtest artifacts

Drop files here to feed the dashboard from a real NautilusTrader backtest:

- `candles_BTC_USD.csv` (columns: `time,open,high,low,close,volume`, `time` = unix seconds)
- `equity.csv` (columns: `time,equity`)

If the files are missing, the backend seeds deterministic sample history so the UI always renders.
