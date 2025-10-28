/**
 * HYROX Scraper v20.3 — Render Stable Edition
 * --------------------------------------------
 * ✅ Auto-installs Chromium at runtime (works on Render free tier)
 * ✅ Crawls both Solo + Doubles (Paris & Birmingham)
 * ✅ Compatible with s7/s8 age groups
 * ✅ Persists results to /data/last-run.json
 * ✅ Fully compatible with your Google Sheets integration
 */

import express from "express";
import { chromium } from "playwright";
import { execSync } from "child_process";
import fs from "fs";
import path from "path";

const app = express();
const PORT = process.env.PORT || 10000;

/* -----------------------------------------------------------
   🧱 Auto-Install Chromium (Render safe)
----------------------------------------------------------- */
try {
  const PLAYWRIGHT_DIR = "/opt/render/project/.playwright";
  if (!fs.existsSync(`${PLAYWRIGHT_DIR}/chromium`)) {
    console.log("🧩 Installing Chromium runtime...");
    execSync("npx playwright install chromium", { stdio: "inherit" });
  } else {
    console.log("✅ Chromium already installed.");
  }
} catch (err) {
  console.warn("⚠️ Skipping Chromium install:", err.message);
}

/* -----------------------------------------------------------
   💾 Cache Setup
----------------------------------------------------------- */
const DATA_DIR = path.join(process.cwd(), "data");
const LAST_RUN_FILE = path.join(DATA_DIR, "last-run.json");
if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });

let cache = { events: [] };
if (fs.existsSync(LAST_RUN_FILE)) {
  cache = JSON.parse(fs.readFileSync(LAST_RUN_FILE, "utf8"));
  console.log(`✅ Loaded ${cache.events.length} cached events.`);
} else {
  console.log("ℹ️ No cache found — starting fresh.");
}

/* -----------------------------------------------------------
   🧠 Utilities
----------------------------------------------------------- */
function looksLikeTime(s) {
  return /^\d{1,2}:\d{2}(:\d{2})?$/.test(s);
}
function looksLikeName(s) {
  return /[A-Za-z]/.test(s) && !looksLikeTime(s) && !/^(\d+|DNF|DSQ)$/i.test(s);
}

/* -----------------------------------------------------------
   🕷️ Scrape Single URL
----------------------------------------------------------- */
async function scrapeSingle(url) {
  console.log(`🔎 Scraping ${url}`);
  const browser = await chromium.launch({
    headless: true,
    args: ["--no-sandbox", "--disable-dev-shm-usage"],
    executablePath: process.env.PLAYWRIGHT_CHROMIUM_PATH || undefined
  });

  const page = await browser.newPage();

  try {
    await page.goto(url, { waitUntil: "networkidle", timeout: 60000 });
    await page.waitForTimeout(1500);

    const rows = await page.$$eval("table tbody tr", trs =>
      trs.slice(0, 3).map(tr => {
        const tds = [...tr.querySelectorAll("td")].map(td => td.innerText.trim());
        const name = tds.find(t => /[A-Za-z]/.test(t) && t.length > 2) || "";
        const time = tds.find(t => /^\d{1,2}:\d{2}(:\d{2})?$/.test(t)) || "";
        const rank = tds.find(t => /^\d+$/.test(t)) || "";
        return { rank, name, time };
      })
    );

    await browser.close();

    if (!rows.length) {
      console.warn(`⚠️ No data found for ${url}`);
      return null;
    }

    return rows;
  } catch (err) {
    console.error(`❌ Error scraping ${url}: ${err.message}`);
    await browser.close();
    return null;
  }
}

/* -----------------------------------------------------------
   🌍 Event URL Builder
----------------------------------------------------------- */
function buildWeekendUrls() {
  const baseUrls = [
    // --- SOLO ---
    "https://www.hyresult.com/ranking/s8-2025-paris-hyrox-men",
    "https://www.hyresult.com/ranking/s8-2025-paris-hyrox-women",
    "https://www.hyresult.com/ranking/s8-2025-birmingham-hyrox-men",
    "https://www.hyresult.com/ranking/s8-2025-birmingham-hyrox-women",

    // --- DOUBLES ---
    "https://www.hyresult.com/ranking/s8-2025-paris-hyrox-doubles-men",
    "https://www.hyresult.com/ranking/s8-2025-paris-hyrox-doubles-women",
    "https://www.hyresult.com/ranking/s8-2025-paris-hyrox-doubles-mixed",
    "https://www.hyresult.com/ranking/s8-2025-birmingham-hyrox-doubles-men",
    "https://www.hyresult.com/ranking/s8-2025-birmingham-hyrox-doubles-women",
    "https://www.hyresult.com/ranking/s8-2025-birmingham-hyrox-doubles-mixed"
  ];

  const ageGroups = [
    "16-24", "25-29", "30-34", "35-39", "40-44", "45-49",
    "50-54", "55-59", "60-64", "65-69", "70-74"
  ];

  const urls = [];
  baseUrls.forEach(base => {
    ageGroups.forEach(ag => urls.push(`${base}?ag=${ag}`));
  });
  return urls;
}

/* -----------------------------------------------------------
   ⚙️ Scrape Batch
----------------------------------------------------------- */
async function runWeekendScrape() {
  const urls = buildWeekendUrls();
  const newEvents = [];

  for (const url of urls) {
    const rows = await scrapeSingle(url);
    if (!rows || !rows.length) continue;

    const cityMatch = url.match(/2025-(.*?)-hyrox/i);
    const city = cityMatch ? cityMatch[1].replace(/-/g, " ").toUpperCase() : "UNKNOWN";
    const genderMatch = url.match(/(men|women|mixed)/i);
    const gender = genderMatch ? genderMatch[1].toUpperCase() : "UNKNOWN";
    const type = url.includes("doubles") ? "Double" : "Solo";
    const agMatch = url.match(/\?ag=(\d{2}-\d{2})/);
    const category = agMatch ? agMatch[1] : "";

    const eventName = `Ranking of 2025 ${city} HYROX ${type.toUpperCase()} ${gender}`;
    const key = `${eventName}_${category}`;

    if (cache.events.some(e => `${e.eventName}_${e.category}` === key)) {
      console.log(`⏩ Skipping cached: ${key}`);
      continue;
    }

    const event = {
      eventName,
      city,
      year: 2025,
      category,
      gender,
      type,
      podium: rows,
      url
    };

    newEvents.push(event);
    cache.events.push(event);

    fs.writeFileSync(LAST_RUN_FILE, JSON.stringify(cache, null, 2));
    console.log(`✅ Added ${eventName} (${category})`);
  }

  console.log(`🎯 Scrape complete — ${newEvents.length} new events added.`);
  return newEvents;
}

/* -----------------------------------------------------------
   🌐 API Routes
----------------------------------------------------------- */
app.get("/", (_req, res) =>
  res.send("✅ HYROX Scraper v20.3 — Render-safe, Paris + Birmingham")
);

app.get("/api/scrape-weekend", async (_req, res) => {
  try {
    const results = await runWeekendScrape();
    res.json({ added: results.length, events: results });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get("/api/last-run", (_req, res) => {
  if (!fs.existsSync(LAST_RUN_FILE))
    return res.status(404).json({ error: "No cache found" });
  res.sendFile(LAST_RUN_FILE);
});

app.post("/api/set-initial-cache", (req, res) => {
  const { events } = req.body;
  if (!events || !Array.isArray(events))
    return res.status(400).json({ error: "Invalid cache payload" });
  cache.events = events;
  fs.writeFileSync(LAST_RUN_FILE, JSON.stringify(cache, null, 2));
  res.json({ status: "✅ Cache restored", count: events.length });
});

app.get("/api/clear-cache", (_req, res) => {
  if (fs.existsSync(LAST_RUN_FILE)) fs.unlinkSync(LAST_RUN_FILE);
  cache = { events: [] };
  res.json({ status: "cleared" });
});

app.get("/api/health", (_req, res) => res.json({ ok: true }));

/* -----------------------------------------------------------
   🚀 Start server
----------------------------------------------------------- */
app.listen(PORT, () =>
  console.log(`🔥 HYROX Scraper v20.3 running on port ${PORT}`)
);
