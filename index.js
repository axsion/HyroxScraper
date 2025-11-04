/**
 * HYROX Scraper v3.9 — Fly.io persistent version
 * ------------------------------------------------
 * ✅ Works with /data mount for persistence
 * ✅ Scrapes all HYROX masters categories dynamically
 * ✅ Avoids re-scraping already processed events
 * ✅ Endpoints:
 *    /api/health
 *    /api/check-events
 *    /api/check-new
 *    /api/scrape
 *    /api/scrape-all
 *    /api/last-run
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
const LAST_RUN_FILE = path.join(DATA_DIR, "last-scraped.json");
const RESULTS_DIR = path.join(DATA_DIR, "results");
const EVENTS_URL =
  "https://raw.githubusercontent.com/axsion/HyroxScraper/main/events.txt";

// Ensure directories exist
if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
if (!fs.existsSync(RESULTS_DIR)) fs.mkdirSync(RESULTS_DIR, { recursive: true });

// 🩺 Health endpoint
app.get("/api/health", (req, res) =>
  res.json({ status: "ok", message: "HYROX Scraper is alive" })
);

// 🔍 Fetch events list dynamically
async function fetchEventsList() {
  const res = await fetch(EVENTS_URL);
  const text = await res.text();
  return text
    .split("\n")
    .map((l) => l.trim())
    .filter((l) => l.startsWith("http"));
}

// 📂 Load or initialize cache
function loadCache() {
  if (!fs.existsSync(LAST_RUN_FILE))
    return { scraped: [], lastUpdate: null, version: 1 };
  return JSON.parse(fs.readFileSync(LAST_RUN_FILE, "utf8"));
}

// 💾 Save cache
function saveCache(cache) {
  fs.writeFileSync(LAST_RUN_FILE, JSON.stringify(cache, null, 2));
}

// 🧠 Build masters-category URLs
function expandMastersUrls(baseUrls) {
  const categories = [
    "45-49",
    "50-54",
    "55-59",
    "60-64",
    "65-69",
    "70-74",
    "75-79",
    "80-84",
  ];
  const divisions = [
    "hyrox-men",
    "hyrox-women",
    "hyrox-doubles-men",
    "hyrox-doubles-women",
    "hyrox-doubles-mixed",
  ];

  const all = [];
  for (const base of baseUrls) {
    const match = base.match(/(s\d{1,2}-\d{4})-(.+)/);
    if (!match) continue;
    const [_, season, city] = match;
    for (const div of divisions)
      for (const cat of categories)
        all.push(`https://www.hyresult.com/ranking/${season}-${city}-${div}?ag=${cat}`);
  }
  return all;
}

// 🧩 Check events endpoint
app.get("/api/check-events", async (req, res) => {
  try {
    const events = await fetchEventsList();
    res.json({ total: events.length, sample: events.slice(0, 5) });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ⚡ Check for new events (compare remote vs cache)
app.get("/api/check-new", async (req, res) => {
  try {
    const base = await fetchEventsList();
    const cache = loadCache();
    const allExpanded = expandMastersUrls(base);
    const newOnes = allExpanded.filter((u) => !cache.scraped.includes(u));
    res.json({
      totalRemote: allExpanded.length,
      cached: cache.scraped.length,
      newEvents: newOnes.length,
      sample: newOnes.slice(0, 3),
    });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// 🕸️ Scrape single page
async function scrapeSingle(url) {
  const browser = await chromium.launch({
    headless: true,
    args: ["--no-sandbox", "--disable-setuid-sandbox"],
  });
  const page = await browser.newPage();
  await page.goto(url, { waitUntil: "domcontentloaded", timeout: 60000 });
  const html = await page.content();
  const $ = cheerio.load(html);

  const title = $("title").text().trim();
  const podium = [];
  $("table tbody tr").slice(0, 3).each((_, el) => {
    const tds = $(el).find("td").map((i, e) => $(e).text().trim()).get();
    if (tds.length) podium.push(tds);
  });

  await browser.close();
  return { url, title, podium };
}

// 🧭 Scrape all
app.get("/api/scrape-all", async (req, res) => {
  const force = req.query.force === "true";
  const cache = loadCache();

  try {
    const baseUrls = await fetchEventsList();
    const allUrls = expandMastersUrls(baseUrls);

    const toCrawl = force
      ? allUrls
      : allUrls.filter((u) => !cache.scraped.includes(u));

    const results = [];
    let count = 0;

    for (const url of toCrawl) {
      try {
        const result = await scrapeSingle(url);
        results.push(result);
        cache.scraped.push(url);
        count++;

        if (count % 5 === 0)
          saveCache({
            ...cache,
            lastUpdate: new Date().toISOString(),
          });
      } catch (err) {
        results.push({ url, error: err.message });
      }
    }

    saveCache({ ...cache, lastUpdate: new Date().toISOString() });

    const file = path.join(
      RESULTS_DIR,
      `${new Date().toISOString().split("T")[0]}.json`
    );
    fs.writeFileSync(file, JSON.stringify(results, null, 2));

    res.json({ total: results.length, savedTo: file });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// 🕓 Last run info
app.get("/api/last-run", (req, res) => {
  if (!fs.existsSync(LAST_RUN_FILE))
    return res.status(404).json({ error: "No last-scraped data found" });
  const data = JSON.parse(fs.readFileSync(LAST_RUN_FILE, "utf8"));
  res.json(data);
});

app.get("/", (req, res) =>
  res.send("✅ HYROX Scraper v3.9 is running! Use /api/scrape-all or /api/check-new")
);

app.listen(PORT, "0.0.0.0", () =>
  console.log(`✅ HYROX Scraper v3.9 running on port ${PORT}`)
);
