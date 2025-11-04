/**
 * HYROX Scraper v5.0 – Dynamic events.txt edition
 * ------------------------------------------------
 * ✅ Fetches events.txt from GitHub dynamically
 * ✅ Writes incremental results to /data/latest.json
 * ✅ Writes failed URLs to /data/failed.json
 * ✅ Safe restart/resume support
 * ✅ Fully Fly.io-compatible (uses /data volume)
 */

import express from "express";
import fetch from "node-fetch";
import * as cheerio from "cheerio";
import { chromium } from "playwright-core";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PORT = process.env.PORT || 10000;
const app = express();

const DATA_DIR = "/data";
const RESULTS_FILE = path.join(DATA_DIR, "latest.json");
const FAILED_FILE = path.join(DATA_DIR, "failed.json");
const EVENTS_SOURCE = "https://raw.githubusercontent.com/axsion/HyroxScraper/main/events.txt";

// ✅ Ensure /data exists
if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });

// Load existing state
let results = fs.existsSync(RESULTS_FILE)
  ? JSON.parse(fs.readFileSync(RESULTS_FILE, "utf-8"))
  : {};
let failed = fs.existsSync(FAILED_FILE)
  ? JSON.parse(fs.readFileSync(FAILED_FILE, "utf-8"))
  : [];

/** Utility: save partial results to disk */
function saveProgress() {
  fs.writeFileSync(RESULTS_FILE, JSON.stringify(results, null, 2));
  fs.writeFileSync(FAILED_FILE, JSON.stringify(failed, null, 2));
}

/** Utility: load event URLs from GitHub dynamically */
async function loadEvents(limit = null) {
  const text = await fetch(EVENTS_SOURCE).then((r) => r.text());
  const urls = text
    .split("\n")
    .map((l) => l.trim())
    .filter((l) => l.startsWith("https"));
  return limit ? urls.slice(0, limit) : urls;
}

/** Extract podiums from a single event page */
async function scrapeEvent(browser, url) {
  const page = await browser.newPage();
  try {
    await page.goto(url, { waitUntil: "networkidle", timeout: 45000 });
    await page.waitForSelector("table", { timeout: 10000 });

    const html = await page.content();
    const $ = cheerio.load(html);
    const rows = $("table tbody tr").slice(0, 3);

    if (rows.length === 0) throw new Error("No podium rows");

    const podium = [];
    rows.each((i, el) => {
      const cols = $(el).find("td");
      podium.push({
        rank: $(cols[0]).text().trim(),
        name: $(cols[1]).text().trim(),
        time: $(cols[2]).text().trim(),
      });
    });

    results[url] = podium;
    saveProgress();
    console.log(`✅ Extracted podium for ${url}`);
    await page.close();
    return true;
  } catch (err) {
    failed.push({ url, error: err.message });
    saveProgress();
    console.log(`❌ Failed ${url}: ${err.message}`);
    await page.close();
    return false;
  }
}

/** Run the full crawl */
async function runCrawl({ force = false, limit = null, concurrency = 1 }) {
  const urls = await loadEvents(limit);
  console.log(`🚀 Starting crawl (${urls.length} urls, concurrency=${concurrency})`);

  const browser = await chromium.launch({
    args: ["--no-sandbox", "--disable-dev-shm-usage"],
    headless: true,
    executablePath: "/ms-playwright/chromium-1194/chrome-linux/chrome",
  });

  const queue = [...urls];
  let active = 0;

  return new Promise((resolve) => {
    const next = async () => {
      if (queue.length === 0 && active === 0) {
        await browser.close();
        saveProgress();
        console.log("🎯 Crawl completed");
        return resolve();
      }
      if (active >= concurrency || queue.length === 0) return;
      const url = queue.shift();
      active++;
      scrapeEvent(browser, url).finally(() => {
        active--;
        next();
      });
      next();
    };
    next();
  });
}

/* ========== EXPRESS API ENDPOINTS ========== */

app.get("/api/health", (req, res) =>
  res.json({ ok: true, app: "HYROX Scraper v5.0", now: new Date().toISOString() })
);

app.post("/api/scrape-all", async (req, res) => {
  const limit = req.query.limit ? parseInt(req.query.limit) : null;
  const concurrency = req.query.concurrency
    ? parseInt(req.query.concurrency)
    : 1;
  const force = req.query.force === "true";

  res.json({ accepted: true, note: "Crawl started in background." });

  runCrawl({ force, limit, concurrency }).catch((err) => {
    console.error("Global crawl error:", err);
  });
});

app.get("/api/last", (req, res) => {
  res.json({
    total: Object.keys(results).length,
    failed: failed.length,
    sample: Object.keys(results).slice(-3),
  });
});

app.listen(PORT, "0.0.0.0", () =>
  console.log(`✅ HYROX Scraper v5.0 running on 0.0.0.0:${PORT}`)
);
