/**
 * HYROX Scraper v33.0
 * -------------------------------------------------------------
 * Stable version for Render:
 * - Uses local Chromium from node_modules (no global install)
 * - Reads dynamic event list from GitHub (events.txt)
 * - Includes /api/health, /api/check-events, /api/scrape-all
 * -------------------------------------------------------------
 */

import express from "express";
import { chromium } from "playwright-chromium";
import fetch from "node-fetch";
import path from "path";
import { fileURLToPath } from "url";
import fs from "fs";

// 🧩 Resolve local path to bundled Chromium binary
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const LOCAL_BROWSER_PATH = path.join(
  __dirname,
  "node_modules",
  "playwright-chromium",
  ".local-browsers",
  "chromium-1124",
  "chrome-linux",
  "chrome"
);

// 🧭 Force Playwright to use local embedded browser
process.env.PLAYWRIGHT_BROWSERS_PATH = path.dirname(LOCAL_BROWSER_PATH);
process.env.PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD = "1";

console.log("🔧 Using local Chromium at:", LOCAL_BROWSER_PATH);

const app = express();
const PORT = process.env.PORT || 1000;
app.use(express.json({ limit: "10mb" }));

// ✅ Cached results to avoid duplicates
let cache = {};

// =======================================================
// 🔹 Utility: Load event URLs from GitHub events.txt
// =======================================================
async function loadEventList() {
  const url = "https://raw.githubusercontent.com/axsion/HyroxScraper/main/events.txt";
  console.log("📄 Loading event URLs from:", url);

  const res = await fetch(url);
  const text = await res.text();
  const urls = text
    .split(/\r?\n/)
    .map((u) => u.trim())
    .filter((u) => u.startsWith("http"));
  console.log(`🌍 Loaded ${urls.length} event URLs`);
  return urls;
}

// =======================================================
// 🔹 Core scraper: crawl all master categories
// =======================================================
const MASTER_AGE_GROUPS = [
  "45-49", "50-54", "55-59", "60-64",
  "65-69", "70-74", "75-79",
  "50-59", "60-69" // legacy S7
];

const EVENT_TYPES = [
  { key: "men", label: "SOLO MEN" },
  { key: "women", label: "SOLO WOMEN" },
  { key: "doubles-men", label: "DOUBLE MEN" },
  { key: "doubles-women", label: "DOUBLE WOMEN" },
  { key: "doubles-mixed", label: "DOUBLE MIXED" }
];

// =======================================================
// 🔹 Scrape function
// =======================================================
async function scrapeEvent(browser, eventUrl) {
  const results = [];
  const eventSlug = eventUrl.split("/").pop().replace("ranking/", "");
  const cityMatch = eventSlug.match(/2025-(.*?)(-|$)/);
  const city = cityMatch ? cityMatch[1].toUpperCase() : "UNKNOWN";

  for (const type of EVENT_TYPES) {
    for (const age of MASTER_AGE_GROUPS) {
      const url = `${eventUrl}-${type.key}?ag=${age}`;
      const key = `${eventSlug}_${age}_${type.key}`;
      if (cache[key]) {
        console.log(`⏩ Skipped cached ${key}`);
        continue;
      }

      console.log("🔎 Visiting", url);
      const page = await browser.newPage();
      try {
        await page.goto(url, { timeout: 15000 });
        await page.waitForSelector(".ranking-table", { timeout: 8000 });

        const podium = await page.$$eval(".ranking-table tbody tr", (rows) =>
          rows.slice(0, 3).map((row) => {
            const cells = row.querySelectorAll("td");
            const name = cells[1]?.innerText?.trim() || "";
            const time = cells[4]?.innerText?.trim() || "";
            return { name, time };
          })
        );

        if (podium.length) {
          const data = {
            key,
            eventName: `Ranking of 2025 ${city} HYROX ${type.label}`,
            city,
            year: "2025",
            category: age,
            gender: type.key.includes("men")
              ? "Men"
              : type.key.includes("women")
              ? "Women"
              : "Mixed",
            type: type.key.includes("double") ? "Double" : "Solo",
            podium,
            url
          };
          results.push(data);
          cache[key] = data;
          console.log(`✅ Added ${data.eventName} (${age})`);
        } else {
          console.log(`⚠️ No podium found for ${url}`);
        }
      } catch (err) {
        console.log(`⚠️ Skipped ${url}: ${err.message}`);
      } finally {
        await page.close();
      }
    }
  }
  return results;
}

// =======================================================
// 🔹 Run full scrape
// =======================================================
async function runFullScrape() {
  console.log("🌍 Starting full HYROX scrape...");
  const eventUrls = await loadEventList();

  console.log(`📦 ${eventUrls.length} event pages to process...`);
  const browser = await chromium.launch({
    headless: true,
    executablePath: LOCAL_BROWSER_PATH
  });

  let added = 0;
  for (const eventUrl of eventUrls) {
    const results = await scrapeEvent(browser, eventUrl);
    added += results.length;
  }

  await browser.close();
  console.log(`🎯 Completed scrape — ${added} new podiums added.`);
  return { added, totalCache: Object.keys(cache).length };
}

// =======================================================
// 🔹 API ROUTES
// =======================================================

// Health route
app.get("/api/health", (req, res) => {
  res.json({
    status: "ok",
    service: "HYROX Scraper",
    node: process.version,
    time: new Date().toISOString(),
    cacheCount: Object.keys(cache).length
  });
});

// Diagnostic route
app.get("/api/check-events", async (req, res) => {
  try {
    const urls = await loadEventList();
    res.json({ total: urls.length, sample: urls.slice(0, 5) });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Full crawl
app.get("/api/scrape-all", async (req, res) => {
  try {
    const result = await runFullScrape();
    res.json(result);
  } catch (err) {
    console.error("❌ Scrape error:", err.message);
    res.status(500).json({ error: err.message });
  }
});

// =======================================================
// 🚀 Launch server
// =======================================================
app.listen(PORT, () => {
  console.log(`🔥 HYROX Scraper v33.0 running on port ${PORT}`);
  console.log(`✅ Health check: /api/health`);
  console.log(`✅ Event check: /api/check-events`);
  console.log(`✅ Full scrape: /api/scrape-all`);
});
