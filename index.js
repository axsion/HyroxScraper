/**
 * HYROX Scraper v3.7 – Fly.io + Persistent Volume
 * ------------------------------------------------
 * ✅ Fully compatible with Fly.io
 * ✅ Chromium auto-installed from mcr.microsoft.com/playwright:v1.56.1-jammy
 * ✅ Persistent storage in /data (Fly volume)
 * ✅ Incremental crawling (skips previously scraped events)
 * ✅ Endpoints:
 *   - /api/health
 *   - /api/check-events
 *   - /api/scrape?url=<eventURL>
 *   - /api/scrape-all
 *   - /api/last-run
 */

import express from "express";
import fetch from "node-fetch";
import * as cheerio from "cheerio";
import { chromium } from "playwright";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PORT = process.env.PORT || 10000;
const app = express();

// 🗂️ Persistent storage
const DATA_DIR = "/data";
if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
const LAST_RUN_FILE = path.join(DATA_DIR, "last-run.json");

// 🌐 Events source
const EVENTS_URL = "https://raw.githubusercontent.com/axsion/HyroxScraper/main/events.txt";

// 🩺 Health check
app.get("/api/health", (req, res) => {
  res.status(200).json({ status: "ok", message: "HYROX Scraper v3.7 is alive" });
});

// 🧩 Check available events
app.get("/api/check-events", async (req, res) => {
  try {
    const response = await fetch(EVENTS_URL);
    const text = await response.text();
    const events = text.split("\n").map(l => l.trim()).filter(l => l.startsWith("http"));
    res.json({ total: events.length, sample: events.slice(0, 5) });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// 🕸️ Scrape a single HYROX event
async function scrapeEvent(url) {
  console.log(`🔎 Scraping ${url}`);
  const browser = await chromium.launch({
    headless: true,
    args: ["--no-sandbox", "--disable-dev-shm-usage", "--disable-setuid-sandbox", "--disable-gpu"]
  });

  const page = await browser.newPage();
  await page.goto(url, { waitUntil: "domcontentloaded", timeout: 60000 });
  const html = await page.content();
  const $ = cheerio.load(html);

  // Example extraction (you can customize later)
  const title = $("title").text() || "Untitled";
  const firstRow = $("table tbody tr").first().text().trim().slice(0, 80);

  await browser.close();

  return {
    url,
    title,
    sample: firstRow || "No data found"
  };
}

// 🧠 Load last-run state
function loadLastRun() {
  if (!fs.existsSync(LAST_RUN_FILE)) return { done: [], date: null };
  try {
    return JSON.parse(fs.readFileSync(LAST_RUN_FILE, "utf8"));
  } catch {
    return { done: [], date: null };
  }
}

// 💾 Save last-run state
function saveLastRun(data) {
  fs.writeFileSync(LAST_RUN_FILE, JSON.stringify(data, null, 2));
}

// 🧭 Scrape all events (incremental)
app.get("/api/scrape-all", async (req, res) => {
  const start = Date.now();
  const lastRun = loadLastRun();
  const done = new Set(lastRun.done || []);

  try {
    const response = await fetch(EVENTS_URL);
    const text = await response.text();
    const urls = text.split("\n").map(l => l.trim()).filter(l => l.startsWith("http"));

    const results = [];
    let newScrapes = 0;

    for (const url of urls) {
      if (done.has(url)) {
        console.log(`⏩ Skipping already scraped: ${url}`);
        continue;
      }

      try {
        const result = await scrapeEvent(url);
        results.push(result);
        done.add(url);
        newScrapes++;
      } catch (e) {
        console.error(`❌ Error scraping ${url}: ${e.message}`);
        results.push({ url, error: e.message });
      }
    }

    const runData = {
      date: new Date().toISOString(),
      total: results.length,
      newScrapes,
      done: Array.from(done)
    };
    saveLastRun(runData);

    const duration = ((Date.now() - start) / 1000).toFixed(1);
    console.log(`✅ Scrape-all complete: ${newScrapes} new events, ${results.length} total (${duration}s)`);

    res.json(runData);
  } catch (error) {
    console.error("❌ scrape-all failed:", error);
    res.status(500).json({ error: error.message });
  }
});

// 🕓 Last run info
app.get("/api/last-run", (req, res) => {
  if (!fs.existsSync(LAST_RUN_FILE))
    return res.status(404).json({ error: "No last-run data found" });
  const data = JSON.parse(fs.readFileSync(LAST_RUN_FILE, "utf8"));
  res.json(data);
});

// 🏠 Root route
app.get("/", (req, res) => {
  res.send(`
    <h1>🏃‍♂️ HYROX Scraper v3.7</h1>
    <p>✅ Fly.io + Persistent /data + Incremental Crawling</p>
    <ul>
      <li><a href="/api/health">/api/health</a></li>
      <li><a href="/api/check-events">/api/check-events</a></li>
      <li><a href="/api/scrape-all">/api/scrape-all</a></li>
      <li><a href="/api/last-run">/api/last-run</a></li>
    </ul>
  `);
});

// 🚀 Start server
app.listen(PORT, "0.0.0.0", () => {
  console.log(`✅ HYROX Scraper v3.7 running on port ${PORT}`);
});
