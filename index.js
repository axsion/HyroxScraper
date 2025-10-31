/**
 * HYROX Scraper v3.4 - Render-proof, Free Tier Compatible
 * -------------------------------------------------------
 * ✅ Runs on Render Free Tier without persistent disk
 * ✅ Chromium installed inside .playwright (baked into image)
 * ✅ Supports /api/health, /api/check-events, /api/scrape, /api/scrape-all, /api/last-run
 * ✅ Used by Google Sheets for automated podium extraction
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

// 🧠 Load the Chromium binary from inside the project
const CHROMIUM_PATH = path.join(
  __dirname,
  ".playwright",
  "chromium-1194",
  "chrome-linux",
  "chrome"
);

// 📦 In-memory cache
let lastRunCache = { updated: null, events: [] };

/**
 * Utility: safely fetch HTML using Playwright (JS-rendered pages)
 */
async function fetchHTML(url) {
  console.log(`🔎 Opening ${url}`);

  if (!fs.existsSync(CHROMIUM_PATH)) {
    throw new Error(`❌ Chromium binary not found at ${CHROMIUM_PATH}`);
  }

  const browser = await chromium.launch({
    headless: true,
    executablePath: CHROMIUM_PATH,
    args: ["--no-sandbox", "--disable-setuid-sandbox"],
  });

  const page = await browser.newPage();
  await page.goto(url, { waitUntil: "networkidle" });
  const html = await page.content();
  await browser.close();
  return html;
}

/**
 * Extract podium data from rendered HTML
 */
function extractPodium(html, url) {
  const $ = cheerio.load(html);
  const rows = $("table tbody tr");
  const podium = [];

  rows.slice(0, 3).each((i, el) => {
    const cols = $(el).find("td");
    const name = $(cols[1]).text().trim();
    const time = $(cols[5]).text().trim();
    if (name && time) podium.push({ name, time });
  });

  if (!podium.length) {
    console.log(`⚠️ No podium found for ${url}`);
  }
  return podium;
}

/**
 * Load all events from the GitHub-hosted events.txt
 */
async function loadEvents() {
  const res = await fetch(
    "https://raw.githubusercontent.com/axsion/HyroxScraper/main/events.txt"
  );
  const text = await res.text();
  return text
    .split("\n")
    .map((l) => l.trim())
    .filter((l) => l.startsWith("https://"));
}

/**
 * Scrape a single event URL
 */
async function scrapeEvent(url) {
  try {
    const html = await fetchHTML(url);
    const podium = extractPodium(html, url);
    const eventMatch = url.match(/ranking\/([^/]+)/);
    const cityMatch = url.match(/ranking\/s\d{1,2}-\d{4}-([a-z-]+)/i);

    return {
      eventName: eventMatch ? eventMatch[1] : "Unknown Event",
      city: cityMatch ? cityMatch[1].toUpperCase() : "Unknown City",
      url,
      podium,
    };
  } catch (err) {
    console.error(`❌ Error scraping ${url}: ${err.message}`);
    return null;
  }
}

/**
 * Scrape all events
 */
app.get("/api/scrape-all", async (req, res) => {
  try {
    const events = await loadEvents();
    console.log(`🌍 Starting full scrape of ${events.length} events...`);

    const results = [];
    for (const url of events) {
      const result = await scrapeEvent(url);
      if (result) results.push(result);
    }

    lastRunCache = { updated: new Date().toISOString(), events: results };
    console.log(`✅ Full scrape complete. ${results.length} events cached.`);

    res.json({ total: results.length, updated: lastRunCache.updated });
  } catch (err) {
    console.error("❌ scrape-all error:", err.message);
    res.status(500).json({ error: err.message });
  }
});

/**
 * Scrape a single URL
 */
app.get("/api/scrape", async (req, res) => {
  const { url } = req.query;
  if (!url) return res.status(400).json({ error: "Missing ?url parameter" });

  try {
    const data = await scrapeEvent(url);
    if (!data) return res.status(404).json({ error: "No podium data found" });
    res.json(data);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
});

/**
 * Return cached data
 */
app.get("/api/last-run", (req, res) => {
  res.json(lastRunCache);
});

/**
 * Health check
 */
app.get("/api/health", (req, res) => {
  res.json({
    status: "ok",
    service: "HYROX Scraper",
    node: process.version,
    time: new Date().toISOString(),
    cacheCount: lastRunCache.events.length || 0,
  });
});

/**
 * Check events file
 */
app.get("/api/check-events", async (req, res) => {
  try {
    const events = await loadEvents();
    res.json({ total: events.length, sample: events.slice(0, 5) });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/**
 * Start server
 */
app.listen(PORT, () => {
  console.log(`✅ HYROX Scraper running on port ${PORT}`);
});
