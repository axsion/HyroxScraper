/**
 * HYROX Scraper v4.6  (Fly.io-Optimized, Incremental + Resume)
 * ------------------------------------------------------------
 * ✅ Dynamic scraping with Playwright (Chromium 1.56)
 * ✅ Incremental save to /data/latest.json after each event
 * ✅ Resume on restart (skips completed URLs)
 * ✅ Shared Chromium instance, concurrency limit (default 3)
 * ✅ Robust logging + progress endpoints
 * ✅ Health + test endpoints for monitoring
 */

import express from "express";
import fs from "fs";
import path from "path";
import { chromium } from "playwright-core";
import fetch from "node-fetch";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PORT = process.env.PORT || 10000;
const app = express();

const DATA_DIR = "/data";
const OUTPUT_FILE = path.join(DATA_DIR, "latest.json");
const LOG_FILE = path.join(DATA_DIR, `scraper-${new Date().toISOString().split("T")[0]}.txt`);

let running = false;
let queue = [];
let done = 0;
let succeeded = 0;
let failed = 0;
let lastUrl = null;
let lastError = null;
let startedAt = null;
let finishedAt = null;
let browser = null;
let concurrency = 3;
let writeInProgress = false;

// --- Utility: Log writer ----------------------------------------------------
function log(msg) {
  const line = `[${new Date().toISOString()}] ${msg}`;
  console.log(line);
  fs.appendFileSync(LOG_FILE, line + "\n");
}

// --- Safe write to JSON file ------------------------------------------------
function safeWrite(results) {
  if (writeInProgress) return;
  writeInProgress = true;
  const tmp = OUTPUT_FILE + ".tmp";
  try {
    fs.writeFileSync(tmp, JSON.stringify(results, null, 2));
    fs.renameSync(tmp, OUTPUT_FILE);
  } catch (e) {
    log(`❌ Failed to write ${OUTPUT_FILE}: ${e.message}`);
  } finally {
    writeInProgress = false;
  }
}

// --- Load existing results (for resume) ------------------------------------
function loadExistingResults() {
  try {
    if (!fs.existsSync(OUTPUT_FILE)) return [];
    const data = JSON.parse(fs.readFileSync(OUTPUT_FILE, "utf8"));
    return Array.isArray(data) ? data : [];
  } catch {
    return [];
  }
}

// --- Scrape one event page --------------------------------------------------
async function scrapeOne(page, url) {
  try {
    await page.goto(url, { waitUntil: "domcontentloaded", timeout: 30000 });
    await page.waitForSelector("table tbody tr", { timeout: 15000 });

    const podium = await page.evaluate(() => {
      const rows = Array.from(document.querySelectorAll("table tbody tr"));
      if (rows.length === 0) return [];
      const parsed = rows.slice(0, 3).map((row, i) => {
        const cols = row.querySelectorAll("td");
        const rank = cols[0]?.innerText?.trim() || "";
        const team = cols[1]?.innerText?.trim() || "";
        const members = cols[2]?.innerText?.trim() || "";
        const time = cols[cols.length - 1]?.innerText?.trim() || "";
        return { rank, team, members, time };
      });
      return parsed;
    });

    if (!podium || podium.length < 3) throw new Error("No podium rows");

    return { url, podium };
  } catch (err) {
    throw new Error(err.message);
  }
}

// --- Worker process ---------------------------------------------------------
async function worker(id, results) {
  while (queue.length > 0) {
    const url = queue.shift();
    lastUrl = url;
    log(`🔎 [${id}] Opening ${url}`);

    const page = await browser.newPage();
    try {
      const result = await scrapeOne(page, url);
      results.push(result);
      succeeded++;
      done++;
      log(`✅ [${id}] OK: ${url}`);
      safeWrite(results);
    } catch (err) {
      failed++;
      done++;
      lastError = err.message;
      log(`❌ [${id}] FAIL: ${url} – ${err.message}`);
    } finally {
      await page.close();
    }
  }
}

// --- Crawl runner -----------------------------------------------------------
async function runCrawl(allUrls, force = false) {
  if (running) return;
  running = true;
  done = succeeded = failed = 0;
  lastUrl = lastError = null;
  startedAt = new Date();
  finishedAt = null;

  const results = force ? [] : loadExistingResults();
  const doneUrls = new Set(results.map(r => r.url));
  queue = allUrls.filter(u => !doneUrls.has(u));

  log(`🚀 Starting crawl – total:${allUrls.length} resume:${results.length} queue:${queue.length} concurrency:${concurrency}`);

  browser = await chromium.launch({
  headless: true,
  executablePath: "/ms-playwright/chromium-1194/chrome-linux/chrome",
  args: [
    "--no-sandbox",
    "--disable-dev-shm-usage",
    "--single-process",
    "--disable-gpu",
    "--disable-background-networking",
    "--disable-software-rasterizer",
  ],
});
log("🎬 Chromium launched successfully inside runCrawl()");


  const workers = [];
  for (let i = 0; i < concurrency; i++) {
    workers.push(worker(i + 1, results));
  }

  await Promise.all(workers);
  await browser.close();

  finishedAt = new Date();
  running = false;
  safeWrite(results);
  log(`🏁 Crawl finished. done:${done} ok:${succeeded} fail:${failed}`);
}

// --- API Endpoints ----------------------------------------------------------

// Health check
app.get("/api/health", (req, res) => {
  res.json({ ok: true, app: "HYROX Scraper v4.6", now: new Date().toISOString() });
});

// Simple event list loader
app.get("/api/check-events", async (req, res) => {
  try {
    const resp = await fetch("https://raw.githubusercontent.com/axsion/HyroxScraper/main/events.txt");
    const text = await resp.text();
    const lines = text.split("\n").filter(l => l.trim());
    res.json({ baseCount: lines.length, total: lines.length * 40, sample: lines.slice(0, 10) });
  } catch (e) {
    res.json({ error: e.message });
  }
});

// Launch full crawl
app.post("/api/scrape-all", async (req, res) => {
  const urlListResp = await fetch("https://raw.githubusercontent.com/axsion/HyroxScraper/main/events.txt");
  const base = (await urlListResp.text()).split("\n").filter(Boolean);

  const allUrls = [];
  const ags = ["45-49", "50-54", "55-59", "60-64", "65-69", "70-74", "75-79", "80-84"];
  const cats = ["hyrox-men", "hyrox-women", "hyrox-doubles-men", "hyrox-doubles-women", "hyrox-doubles-mixed"];

  base.forEach(b => {
    cats.forEach(c => {
      ags.forEach(a => {
        allUrls.push(`${b}-${c}?ag=${a}`);
      });
    });
  });

  const force = req.query.force === "true";
  concurrency = parseInt(req.query.concurrency || "3", 10);

  res.json({ accepted: true, planned: allUrls.length, force, note: "Background crawl started." });
  runCrawl(allUrls, force).catch(e => log(`❌ Global error: ${e.message}`));
});

// One-off test endpoint
app.get("/api/test-one", async (req, res) => {
  const url =
    req.query.url ||
    "https://www.hyresult.com/ranking/s8-2025-birmingham-hyrox-doubles-mixed?ag=45-49";
  try {
    const browser = await chromium.launch({
      headless: true,
      args: ["--no-sandbox", "--disable-dev-shm-usage", "--single-process"],
      executablePath: "/usr/bin/chromium",
    });
    const page = await browser.newPage();
    const result = await scrapeOne(page, url);
    await browser.close();
    res.json({ ok: true, url, podium: result.podium });
  } catch (err) {
    res.json({ ok: false, error: err.message });
  }
});

// Progress + logs
app.get("/api/progress", (req, res) => {
  res.json({ running, queued: queue.length, done, succeeded, failed, lastUrl, lastError, startedAt, finishedAt });
});
app.get("/api/logs", (req, res) => {
  const lines = fs.existsSync(LOG_FILE) ? fs.readFileSync(LOG_FILE, "utf8").trim().split("\n").slice(-100) : [];
  res.json({ file: path.basename(LOG_FILE), lines });
});

// --- Start server -----------------------------------------------------------
app.listen(PORT, "0.0.0.0", () => {
  log(`✅ HYROX Scraper v4.6 listening on 0.0.0.0:${PORT}`);
});
