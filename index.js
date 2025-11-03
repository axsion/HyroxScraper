/**
 * HYROX Scraper v3.5 - Fly.io Optimized
 * -------------------------------------
 * ✅ Works with Fly.io persistent or free-tier machines
 * ✅ Detects Chromium automatically (/usr/bin, /ms-playwright, or .playwright)
 * ✅ Handles /api/health, /api/check-events, /api/scrape-all, /api/last-run
 * ✅ Compatible with Google Sheets automation
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

app.use(express.json());

// 🧠 Detect Chromium binary across environments (Fly, Render, Local)
const DEFAULT_CHROMIUM_PATHS = [
  "/usr/bin/chromium",
  "/usr/bin/chromium-browser",
  "/usr/lib/chromium/chrome",
  "/ms-playwright/chromium-*/chrome-linux/chrome",
  path.join(__dirname, ".playwright", "chromium-1194", "chrome-linux", "chrome"),
];
let CHROMIUM_PATH = DEFAULT_CHROMIUM_PATHS.find((p) => fs.existsSync(p));
if (!CHROMIUM_PATH) {
  console.warn("⚠️ Could not auto-detect Chromium, falling back to default system path");
  CHROMIUM_PATH = "/usr/bin/chromium";
}
console.log(`🧩 Chromium binary detected at: ${CHROMIUM_PATH}`);

// 🗂️ Cache in memory (optionally persisted if Fly volume is mounted)
let lastRun = [];
const CACHE_FILE = path.join(__dirname, "data", "cache.json");
if (fs.existsSync(CACHE_FILE)) {
  try {
    lastRun = JSON.parse(fs.readFileSync(CACHE_FILE, "utf8"));
    console.log(`💾 Loaded ${lastRun.length} cached events`);
  } catch (err) {
    console.error("⚠️ Failed to parse cache file:", err);
  }
}

// 🩺 Health endpoint
app.get("/api/health", (req, res) => {
  res.json({
    status: "ok",
    service: "HYROX Scraper",
    node: process.version,
    time: new Date().toISOString(),
    cacheCount: lastRun.length,
  });
});

// 🔎 List of events (canonical source)
app.get("/api/check-events", async (req, res) => {
  const eventsTxt =
    "https://raw.githubusercontent.com/axsion/HyroxScraper/main/events.txt";
  try {
    const response = await fetch(eventsTxt);
    const text = await response.text();
    const urls = text.split("\n").filter((line) => line.trim().length > 0);
    res.json({ total: urls.length, sample: urls.slice(0, 5) });
  } catch (err) {
    res.status(500).json({ error: "Failed to load events.txt", details: err.message });
  }
});

// 🧹 Utility: Extract podium data from HTML
function extractPodiumData(html, url) {
  const $ = cheerio.load(html);
  const rows = $("table tr");

  const podium = [];
  rows.each((i, el) => {
    const rank = $(el).find("td:first").text().trim();
    if (["1", "2", "3"].includes(rank)) {
      const name = $(el).find("td:nth-child(2)").text().trim();
      const time = $(el).find("td:nth-child(3)").text().trim();
      podium.push({ name, time });
    }
  });

  if (podium.length === 0) {
    console.warn(`⚠️ No podium found for ${url}`);
  }

  return podium;
}

// 🕸️ Scrape a single URL
async function scrapeSingle(url) {
  console.log(`🔎 Opening ${url}`);
  let browser;

  try {
    browser = await chromium.launch({
      headless: true,
      executablePath: CHROMIUM_PATH,
      args: ["--no-sandbox", "--disable-setuid-sandbox"],
    });
    const page = await browser.newPage();
    await page.goto(url, { waitUntil: "domcontentloaded", timeout: 60000 });
    const html = await page.content();
    await browser.close();

    const podium = extractPodiumData(html, url);
    return { url, podium, success: podium.length > 0 };
  } catch (err) {
    console.error(`❌ Error scraping ${url}: ${err.message}`);
    if (browser) await browser.close();
    return { url, error: err.message, podium: [] };
  }
}

// 🌍 Scrape all URLs from events.txt
app.get("/api/scrape-all", async (req, res) => {
  const eventsTxt =
    "https://raw.githubusercontent.com/axsion/HyroxScraper/main/events.txt";

  console.log("🌍 Starting full scrape...");
  const startTime = Date.now();
  const scraped = [];

  try {
    const response = await fetch(eventsTxt);
    const urls = (await response.text())
      .split("\n")
      .filter((u) => u.trim().length > 0);

    console.log(`📦 Loaded ${urls.length} events from list`);

    for (const url of urls) {
      const result = await scrapeSingle(url);
      if (result.success) scraped.push(result);
    }

    // 🪣 Cache results to disk
    lastRun = scraped;
    fs.mkdirSync(path.dirname(CACHE_FILE), { recursive: true });
    fs.writeFileSync(CACHE_FILE, JSON.stringify(scraped, null, 2));

    console.log(
      `✅ Full scrape complete: ${scraped.length} podiums in ${(
        (Date.now() - startTime) /
        1000
      ).toFixed(1)}s`
    );

    res.json({ total: scraped.length, updated: new Date().toISOString() });
  } catch (err) {
    console.error("❌ scrape-all error:", err.message);
    res.status(500).json({ error: err.message });
  }
});

// 🧾 Return last-run cache
app.get("/api/last-run", (req, res) => {
  res.json({ total: lastRun.length, events: lastRun });
});

// 🛠️ Fallback route
app.get("/", (req, res) => {
  res.send(
    `<h1>HYROX Scraper v3.5 (Fly.io)</h1><p>Endpoints:<br>
     /api/health<br>/api/check-events<br>/api/scrape-all<br>/api/last-run</p>`
  );
});

// 🚀 Launch server
app.listen(PORT, "0.0.0.0", () => {
  console.log(`✅ HYROX Scraper server running on port ${PORT}`);
});
