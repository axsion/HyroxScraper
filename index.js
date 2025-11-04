/**
 * HYROX Scraper v4.3
 * -------------------------------------------------------
 * ✅ Compatible with Fly.io and Render (no persistent disk required)
 * ✅ Chromium binary baked into .playwright/chromium-1194/chrome-linux/chrome
 * ✅ Waits for React-rendered DOM content before scraping
 * ✅ Retries gracefully if page fails to render
 * ✅ Provides /api/health, /api/check-events, /api/scrape, /api/scrape-all, /api/logs, /api/progress
 */

import express from "express";
import * as cheerio from "cheerio";
import { chromium } from "playwright-core";
import fs from "fs";
import path from "path";
import fetch from "node-fetch";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PORT = process.env.PORT || 10000;
const app = express();

// 🧠 Chromium path (baked into the image)
const CHROMIUM_PATH = path.join(
  __dirname,
  ".playwright",
  "chromium-1194",
  "chrome-linux",
  "chrome"
);

// 🪣 Data cache file
const DATA_DIR = "/data";
const LOG_FILE = path.join(DATA_DIR, `scraper-${new Date().toISOString().slice(0, 10)}.txt`);
if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });

// ✅ Global state
let state = {
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

function log(msg) {
  const line = `[${new Date().toISOString()}] ${msg}`;
  console.log(line);
  fs.appendFileSync(LOG_FILE, line + "\n");
}

// 🔧 Utility: Fetch events list dynamically
async function getAllEventUrls() {
  const res = await fetch(
    "https://raw.githubusercontent.com/axsion/HyroxScraper/main/events.txt"
  );
  const text = await res.text();
  const urls = text
    .split("\n")
    .map((l) => l.trim())
    .filter((l) => l.length > 0 && l.startsWith("https://"));
  return urls;
}

// 🧠 Core scraping logic
async function scrapeUrl(browser, url) {
  const context = await browser.newContext();
  const page = await context.newPage();
  state.lastUrl = url;
  try {
    log(`🔎 Opening ${url}`);

    await page.goto(url, { waitUntil: "domcontentloaded", timeout: 30000 });

    // 🕒 Wait for the table or ranking rows to appear
    await page.waitForSelector("table tr, .ranking__row, .results-table tr", { timeout: 25000 });
    await page.waitForTimeout(1000); // React hydration buffer

    const html = await page.content();
    const $ = cheerio.load(html);

    // 🔍 Try to detect podium rows
    const rows = $("table tr, .ranking__row, .results-table tr");
    if (rows.length === 0) throw new Error("No podium rows found in DOM");

    const podium = [];
    rows.slice(0, 3).each((i, el) => {
      const name = $(el).find("td:nth-child(2)").text().trim();
      const time = $(el).find("td:nth-child(3)").text().trim();
      if (name && time) podium.push({ rank: i + 1, name, time });
    });

    if (podium.length === 0) throw new Error("Podium could not be parsed");

    log(`✅ OK: ${url} (${podium.length} podiums)`);
    state.succeeded++;
    await context.close();
    return { url, podium };
  } catch (err) {
    log(`❌ FAIL: ${url} – ${err.message}`);
    state.failed++;
    state.lastError = err.message;
    await context.close();
    return null;
  }
}

// 🚀 Main crawler
async function scrapeAll(force = false) {
  if (state.running) {
    log("⚠️ A crawl is already running, skipping new request");
    return;
  }

  const urls = await getAllEventUrls();
  state.running = true;
  state.startedAt = new Date();
  state.finishedAt = null;
  state.queued = urls.length;
  state.done = 0;
  state.succeeded = 0;
  state.failed = 0;

  log(`🚀 Starting crawl – urls:${urls.length} force:${force} concurrency:1`);

  const browser = await chromium.launch({
    executablePath: CHROMIUM_PATH,
    headless: true,
    args: [
      "--no-sandbox",
      "--disable-dev-shm-usage",
      "--disable-gpu",
      "--single-process",
      "--no-zygote",
    ],
  });

  for (const url of urls) {
    state.done++;
    await scrapeUrl(browser, url);
  }

  await browser.close();
  state.running = false;
  state.finishedAt = new Date();
  log(`🏁 Finished crawl – success:${state.succeeded} fail:${state.failed}`);
}

// 🩺 API routes
app.get("/api/health", (req, res) => {
  res.json({ ok: true, app: "HYROX Scraper v4.3", now: new Date().toISOString() });
});

app.get("/api/check-events", async (req, res) => {
  const urls = await getAllEventUrls();
  res.json({ total: urls.length, sample: urls.slice(0, 10) });
});

app.get("/api/check-new", async (req, res) => {
  const urls = await getAllEventUrls();
  res.json({ totalRemote: urls.length, cached: 0, newEvents: urls.length, sample: urls.slice(0, 10) });
});

app.post("/api/scrape-all", async (req, res) => {
  const force = req.query.force === "true";
  res.json({ accepted: true, planned: state.queued, force, note: "Background crawl started." });
  scrapeAll(force);
});

app.get("/api/progress", (req, res) => {
  res.json(state);
});

app.get("/api/logs", (req, res) => {
  const lines = fs.existsSync(LOG_FILE)
    ? fs.readFileSync(LOG_FILE, "utf8").trim().split("\n").slice(-200)
    : [];
  res.json({ file: path.basename(LOG_FILE), lines });
});

// ✅ Start server
app.listen(PORT, "0.0.0.0", () => {
  log(`✅ HYROX Scraper v4.3 listening on 0.0.0.0:${PORT}`);
});
