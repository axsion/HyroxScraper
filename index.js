/**
 * HYROX Scraper v4.7 – Fly.io + Playwright v1.56 build
 * -----------------------------------------------------
 * ✅ Works on Fly.io with /data persistent volume
 * ✅ Uses baked Chromium binary from Playwright image
 * ✅ Exposes /api/health, /api/check-new, /api/scrape-all, /api/progress, /api/logs, /api/test-one
 * ✅ Saves live progress + log file to /data
 */

import express from "express";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { chromium } from "playwright";
import fetch from "node-fetch";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PORT = process.env.PORT || 10000;
const LOG_DIR = "/data";
const app = express();

// ensure /data exists
if (!fs.existsSync(LOG_DIR)) fs.mkdirSync(LOG_DIR, { recursive: true });

// global state for progress
global.scrapeProgress = {
  running: false,
  queued: 0,
  done: 0,
  succeeded: 0,
  failed: 0,
  lastUrl: null,
  lastError: null,
  startedAt: null,
  finishedAt: null,
};

// logging helper
function log(msg) {
  const line = `[${new Date().toISOString()}] ${msg}`;
  console.log(line);
  const file = path.join(LOG_DIR, `scraper-${new Date().toISOString().split("T")[0]}.txt`);
  fs.appendFileSync(file, line + "\n");
}

// small wait helper
const delay = (ms) => new Promise((r) => setTimeout(r, ms));

/* ------------------------------------------------------------------ */
/* 🔍 Core single-event scraper                                       */
/* ------------------------------------------------------------------ */
async function scrapeSingleEvent(url) {
  log(`🔎 Opening ${url}`);

  const browser = await chromium.launch({
    headless: true,
    args: ["--no-sandbox", "--disable-dev-shm-usage"],
  });

  try {
    const page = await browser.newPage();
    await page.goto(url, { timeout: 45000, waitUntil: "domcontentloaded" });
    await page.waitForSelector("table tbody tr", { timeout: 10000 });

    const podium = await page.evaluate(() => {
      const rows = Array.from(document.querySelectorAll("table tbody tr")).slice(0, 3);
      return rows.map((row) => {
        const cells = Array.from(row.querySelectorAll("td"));
        const rank = cells[0]?.innerText.trim() || "";
        const team = cells[1]?.innerText.trim() || "";
        const members = cells[2]?.innerText.trim() || "";
        const time = cells[cells.length - 1]?.innerText.trim() || "";
        return { rank, team, members, time };
      });
    });

    await browser.close();

    if (!podium || podium.length === 0) throw new Error("No podium rows");
    log(`✅ Extracted ${podium.length} podium entries from ${url}`);
    return { ok: true, url, podium };
  } catch (err) {
    await browser.close();
    log(`❌ Error scraping ${url}: ${err.message}`);
    return { ok: false, url, error: err.message };
  }
}

/* ------------------------------------------------------------------ */
/* 🧠 Full scrape controller                                          */
/* ------------------------------------------------------------------ */
async function startFullScrape({ force = false, limit = 0, concurrency = 1 }) {
  if (global.scrapeProgress.running && !force) {
    return { accepted: false, note: "Already running. Use ?force=true to override." };
  }

  const eventsFile = path.join(__dirname, "events.txt");
  const urls = fs.readFileSync(eventsFile, "utf8").split("\n").filter(Boolean);
  const slice = limit > 0 ? urls.slice(0, limit) : urls;

  global.scrapeProgress = {
    running: true,
    queued: slice.length,
    done: 0,
    succeeded: 0,
    failed: 0,
    lastUrl: null,
    lastError: null,
    startedAt: new Date().toISOString(),
    finishedAt: null,
  };

  log(`🚀 Starting crawl – total:${slice.length} resume:0 queue:${slice.length} concurrency:${concurrency}`);

  const results = [];
  const active = new Set();

  async function runOne(url) {
    global.scrapeProgress.lastUrl = url;
    const result = await scrapeSingleEvent(url);
    global.scrapeProgress.done++;
    if (result.ok) {
      global.scrapeProgress.succeeded++;
      results.push(result);
    } else {
      global.scrapeProgress.failed++;
      global.scrapeProgress.lastError = result.error;
    }

    // write partial results so they’re persisted even if crash
    fs.writeFileSync(path.join(LOG_DIR, "latest.json"), JSON.stringify(results, null, 2));
  }

  for (const url of slice) {
    const job = runOne(url);
    active.add(job);
    job.finally(() => active.delete(job));

    if (active.size >= concurrency) {
      await Promise.race(active);
    }
  }

  await Promise.all(active);

  global.scrapeProgress.running = false;
  global.scrapeProgress.finishedAt = new Date().toISOString();
  fs.writeFileSync(path.join(LOG_DIR, "latest.json"), JSON.stringify(results, null, 2));

  log(`🏁 Crawl finished: ok:${global.scrapeProgress.succeeded}, fail:${global.scrapeProgress.failed}`);
  return { accepted: true, planned: slice.length, force, note: "Background crawl completed." };
}

/* ------------------------------------------------------------------ */
/* 🌐 API ROUTES                                                     */
/* ------------------------------------------------------------------ */

// health
app.all("/api/health", (req, res) => {
  res.json({ ok: true, app: "HYROX Scraper v4.7", now: new Date().toISOString() });
});

// placeholder
app.all("/api/check-new", (req, res) => {
  res.json({ ok: true, totalRemote: 0, newEvents: 0 });
});

// progress
app.all("/api/progress", (req, res) => res.json(global.scrapeProgress));

// logs
app.all("/api/logs", (req, res) => {
  const logPath = path.join(LOG_DIR, `scraper-${new Date().toISOString().split("T")[0]}.txt`);
  if (fs.existsSync(logPath)) {
    const lines = fs.readFileSync(logPath, "utf8").split("\n").slice(-100);
    res.json({ file: path.basename(logPath), lines });
  } else {
    res.json({ ok: false, error: "No log file found." });
  }
});

// test-one
app.all("/api/test-one", async (req, res) => {
  const testUrl =
    "https://www.hyresult.com/ranking/s8-2025-birmingham-hyrox-doubles-mixed?ag=45-49";
  const result = await scrapeSingleEvent(testUrl);
  res.json(result);
});

// scrape-all
app.all("/api/scrape-all", async (req, res) => {
  const force = req.query.force === "true";
  const limit = parseInt(req.query.limit || "0");
  const concurrency = parseInt(req.query.concurrency || "1");
  const result = await startFullScrape({ force, limit, concurrency });
  res.json(result);
});

/* ------------------------------------------------------------------ */
/* 🚀 Start server                                                   */
/* ------------------------------------------------------------------ */
app.listen(PORT, "0.0.0.0", () => log(`✅ HYROX Scraper v4.7 listening on 0.0.0.0:${PORT}`));

