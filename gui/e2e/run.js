// Browser E2E for the Nautilus GUI.
// Requires backend :8000 + frontend :3000 (see gui/README.md), then:
//   npm ci && npx playwright install chromium && npm test
// Env: BASE_URL (default http://localhost:3000), SHOTS (screenshot dir).
const { chromium } = require("playwright");
const path = require("path");
const fs = require("fs");

const BASE = process.env.BASE_URL || "http://localhost:3000";
const OUT = process.env.SHOTS || path.join(__dirname, "shots");
fs.mkdirSync(OUT, { recursive: true });

const VIEWS = [
  ["Monitor", "Trading Overview"],
  ["Backtest", "Backtest"],
  ["Markets", "Price Charts"],
  ["Positions", "Positions"],
  ["Orders", "Orders & Fills"],
  ["Strategies", "Strategies"],
  ["Events", "Event Feed"],
  ["Integrations", "Integrations"],
  ["Settings", "Settings"],
];

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

(async () => {
  const pageErrors = [];
  const consoleErrors = [];
  const results = [];
  let failed = false;

  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  const t0 = Date.now();
  page.on("pageerror", (e) => {
    const s = String(e);
    pageErrors.push(s);
    console.log(
      `[+${((Date.now() - t0) / 1000).toFixed(1)}s] PAGEERROR:`,
      s.match(/#(\d+)/)?.[0] || s.slice(0, 80)
    );
  });
  page.on("console", (m) => {
    if (m.type() === "error") consoleErrors.push(m.text());
  });

  const check = (name, ok, detail = "") => {
    results.push(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? " — " + detail : ""}`);
    if (!ok) failed = true;
  };

  const report = () => {
    console.log("── checks ──");
    for (const r of results) console.log(r);
    console.log("── page errors ──");
    console.log(pageErrors.length ? pageErrors.join("\n") : "(none)");
    console.log("── console errors ──");
    const real = consoleErrors.filter((e) => !/favicon|fonts\./i.test(e));
    console.log(real.length ? real.join("\n") : "(none)");
    const ok = !failed && pageErrors.length === 0;
    console.log(`\nE2E RESULT: ${ok ? "PASS" : "FAIL"}`);
    return ok;
  };

  // ── 1. initial load ────────────────────────────────────────────────
  await page.goto(BASE, { waitUntil: "load", timeout: 30000 });
  const title = await page.title();
  check("page title", title.includes("Nautilus GUI"), title);

  await page.locator("h1", { hasText: "Trading Overview" }).first().waitFor({ timeout: 15000 });
  check("monitor h1 renders", true);

  const side = await page.locator("aside").first().innerText();
  check("sidebar brand", side.includes("Nautilus GUI") && side.includes("Live Monitor"));

  let live = false;
  for (let i = 0; i < 20; i++) {
    const txt = await page.locator("main").innerText();
    if (txt.includes("· connected")) { live = true; break; }
    await sleep(500);
  }
  check("websocket connected", live);

  let ticks = false;
  for (let i = 0; i < 20; i++) {
    const txt = await page.locator("footer").innerText().catch(() => "");
    if (/ticks \d+/.test(txt)) { ticks = true; break; }
    await sleep(500);
  }
  check("backend snapshot streaming", ticks);

  await sleep(1500);
  const canvases = await page.locator("main canvas").count();
  check("monitor charts rendered", canvases >= 1, `${canvases} canvas`);

  await page.screenshot({ path: path.join(OUT, "01-monitor.png") });

  // ── 2. walk every nav item ─────────────────────────────────────────
  const desktop = page.locator("aside").first();
  for (let i = 0; i < VIEWS.length; i++) {
    const [label, h1] = VIEWS[i];
    if (label === "Monitor") continue;
    await desktop.getByRole("button", { name: label, exact: true }).click();
    try {
      await page.locator("h1", { hasText: h1 }).first().waitFor({ timeout: 8000 });
      check(`nav → ${label}`, true);
    } catch {
      check(`nav → ${label}`, false, `h1 "${h1}" not found`);
    }
    await sleep(400);
    await page.screenshot({
      path: path.join(OUT, `${String(i + 1).padStart(2, "0")}-${label.toLowerCase()}.png`),
    });
  }

  // ── 3. run a backtest through the UI ───────────────────────────────
  try {
    await desktop.getByRole("button", { name: "Backtest", exact: true }).click({ timeout: 5000 });
    await page.locator("h1", { hasText: "Backtest" }).first().waitFor({ timeout: 8000 });
    await page.getByText("Run configuration").waitFor({ timeout: 8000 });
    check("backtest view reachable", true);
  } catch (e) {
    check("backtest view reachable", false, e.message.split("\n")[0]);
    const ok = report();
    await browser.close().catch(() => {});
    process.exit(ok ? 0 : 1);
  }
  await page.screenshot({ path: path.join(OUT, "10-backtest-config.png") });

  const runBtn = page.getByRole("button", { name: /Run backtest/ });
  await runBtn.waitFor({ timeout: 5000 });
  check("run button enabled", !(await runBtn.isDisabled()));
  await runBtn.click();

  let ran = false;
  let errMsg = "";
  for (let i = 0; i < 60; i++) {
    if (await page.getByText("Equity curve").first().isVisible().catch(() => false)) {
      ran = true;
      break;
    }
    const errEl = page.locator("p.text-rose-400");
    if (await errEl.first().isVisible().catch(() => false)) {
      errMsg = await errEl.first().innerText().catch(() => "");
      break;
    }
    await sleep(1000);
  }
  check("backtest completed", ran, ran ? "" : errMsg || "timeout after 60s");

  if (ran) {
    check("metrics cards", await page.getByText("Total PnL").first().isVisible().catch(() => false));
    check(
      "closed positions table",
      await page.getByText("Closed positions").first().isVisible().catch(() => false)
    );
    check("history table", await page.getByText("Recent runs").first().isVisible().catch(() => false));
    await sleep(1200);
    await page.screenshot({ path: path.join(OUT, "11-backtest-result.png"), fullPage: true });
  }

  // ── 4. back to monitor after the run ───────────────────────────────
  await desktop.getByRole("button", { name: "Monitor", exact: true }).click();
  await page.locator("h1", { hasText: "Trading Overview" }).first().waitFor({ timeout: 8000 });
  await sleep(1500);
  await page.screenshot({ path: path.join(OUT, "12-monitor-after.png") });

  const ok = report();
  await browser.close().catch(() => {});
  process.exit(ok ? 0 : 1);
})().catch(async (e) => {
  console.error("E2E crashed:", e.message);
  process.exit(2);
});
