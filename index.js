/**
 * HYROX Scraper v4.8 (Fly.io Stable)
 * ----------------------------------
 * ✅ Uses Playwright Chromium baked into the image (/ms-playwright/chromium-1194/)
 * ✅ Extracts podium data (top 3) for all Masters categories (45+)
 * ✅ Writes incremental results to /data/latest.json
 * ✅ Exposes /api/scrape-all, /api/test-one, /api/check-new, /api/progress, /api/logs
 */

import express from "express";
import fs from "fs";
import path from "path";
import { chromium } from "playwright-core";
import * as cheerio from "cheerio";
import fetch from "node-fetch";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const app = express();
const PORT = process.env.PORT || 10000;
const DATA_DIR = "/data";
const LOG_FILE = path.join(DATA_DIR, `scraper-${new Date().toISOString().split("T")[0]}.txt`);
const CACHE_FILE = path.join(DATA_DIR, "latest.json");

// ✅ Unified Chromium binary path for Fly.io
const CHROMIUM_PATH = "/ms-playwright/chromium-1194/chrome-linux/chrome";

// Masters categories only
const MASTER_AGES = ["45-49", "50-54", "55-59", "60-64", "65-69", "70-74", "75-79", "80-84"];

// Global state
let isRunning = false;
let progress = { running: false, queued: 0, done: 0, succeeded: 0, failed: 0, lastUrl: null, lastError: null, startedAt: null, finishedAt: null };

// --- Utility Functions ---
function log(msg) {
  const line = `[${new Date().toISOString()}] ${msg}`;
  console.log(line);
  fs.appendFileSync(LOG_FILE, line + "\n");
}

function saveProgress() {
  fs.writeFileSync(path.join(DATA_DIR, "progress.json"), JSON.stringify(progress, null, 2));
}

function savePartial(results) {
  fs.writeFileSync(CACHE_FILE, JSON.stringify(results, null, 2));
}

// --- Browser Launcher ---
async function launchBrowser() {
  return await chromium.launch({
    headless: true,
    executablePath: CHROMIUM_PATH,
    args: [
      "--no-sandbox",
      "--disable-dev-shm-usage",
      "--single-process",
      "--disable-gpu",
      "--disable-background-networking",
      "--disable-software-rasterizer",
    ],
  });
}

// --- Podium Extractor ---
async function extractPodium(url) {
  const browser = await launchBrowser();
  const page = await browser.newPage();

  try {
    log(`🔎 Opening ${url}`);
    await page.goto(url, { timeout: 60000, waitUntil: "domcontentloaded" });
    await page.waitForSelector("table", { timeout: 10000 });

    const html = await page.content();
    const $ = cheerio.load(html);

    // Parse the first 3 rows in the ranking table
    const podium = [];
    $("table tbody tr").slice(0, 3).each((i, el) => {
      const rank = $(el).find("td:nth-child(1)").text().trim();
      const team = $(el).find("td:nth-child(2)").text().trim();
      const members = $(el).find("td:nth-child(3)").text().trim();
      const time = $(el).find("td:last-child").text().trim();
      podium.push({ rank, team, members, time });
    });

    if (podium.length === 0) throw new Error("No podium rows");
    log(`✅ Extracted ${podium.length} podium entries from ${url}`);

    await browser.close();
    return { url, podium };
  } catch (err) {
    await browser.close();
    throw new Error(err.message);
  }
}

// --- Build All URLs ---
async function buildEventUrls() {
  const res = await fetch("https://raw.githubusercontent.com/axsion/HyroxScraper/main/events.txt");
  const lines = (await res.text()).split("\n").filter(Boolean);

  const urls = [];
  for (const line of lines) {
    const base = line.trim();
    for (const age of MASTER_AGES) {
      urls.push(`${base}-hyrox-men?ag=${age}`);
      urls.push(`${base}-hyrox-women?ag=${age}`);
      urls.push(`${base}-hyrox-doubles-men?ag=${age}`);
      urls.push(`${base}-hyrox-doubles-women?ag=${age}`);
      urls.push(`${base}-hyrox-doubles-mixed?ag=${age}`);
    }
  }
  return urls;
}

// --- Full Crawl ---
async function runCrawl({ force = false, concurrency = 2 } = {}) {
  if (isRunning) throw new Error("Scrape already running");
  isRunning = true;

  const urls = await buildEventUrls();
  progress = {
    running: true,
    queued: urls.length,
    done: 0,
    succeeded: 0,
    failed: 0,
    lastUrl: null,
    lastError: null,
    startedAt: new Date().toISOString(),
    finishedAt: null,
  };
  log(`🚀 Starting crawl – total:${urls.length} resume:0 queue:${urls.length} concurrency:${concurrency}`);
  saveProgress();

  const results = [];
  const queue = [...urls];
  const active = new Set();

  async function worker() {
    while (queue.length > 0) {
      const url = queue.shift();
      progress.lastUrl = url;
      try {
        const data = await extractPodium(url);
        results.push(data);
        progress.succeeded++;
      } catch (err) {
        progress.failed++;
        progress.lastError = err.message;
        log(`❌ FAIL: ${url} – ${err.message}`);
      } finally {
        progress.done++;
        saveProgress();
        savePartial(results);
      }
    }
  }

  for (let i = 0; i < concurrency; i++) {
    const w = worker();
    active.add(w);
    w.finally(() => active.delete(w));
  }

  await Promise.all(active);
  progress.running = false;
  progress.finishedAt = new Date().toISOString();
  saveProgress();
  savePartial(results);
  isRunning = false;

  log(`🏁 Crawl completed: ${progress.succeeded}/${urls.length} succeeded`);
  return results;
}

// --- Express Routes ---
app.get("/api/health", (req, res) => {
  res.json({ ok: true, app: "HYROX Scraper v4.8", now: new Date().toISOString() });
});

app.get("/api/logs", (req, res) => {
  const lines = fs.existsSync(LOG_FILE) ? fs.readFileSync(LOG_FILE, "utf8").split("\n").slice(-1000) : [];
  res.json({ file: path.basename(LOG_FILE), lines });
});

app.get("/api/progress", (req, res) => res.json(progress));

app.post("/api/scrape-all", async (req, res) => {
  if (isRunning) return res.json({ accepted: false, note: "Already running." });
  const force = req.query.force === "true";
  const concurrency = parseInt(req.query.concurrency || "2", 10);
  res.json({ accepted: true, planned: 0, force, note: "Background crawl started." });
  runCrawl({ force, concurrency }).catch((err) => {
    log(`❌ Global error: ${err.message}`);
    progress.running = false;
    saveProgress();
  });
});

app.get("/api/test-one", async (req, res) => {
  try {
    const url = "https://www.hyresult.com/ranking/s8-2025-birmingham-hyrox-doubles-mixed?ag=45-49";
    const data = await extractPodium(url);
    res.json({ ok: true, ...data });
  } catch (err) {
    res.json({ ok: false, error: err.message });
  }
});

// --- Server Startup ---
app.listen(PORT, "0.0.0.0", () => {
  log(`✅ HYROX Scraper v4.8 listening on 0.0.0.0:${PORT}`);
});
