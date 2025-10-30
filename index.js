/**
 * HYROX Scraper v31.5
 * -------------------
 * - Reads event list from GitHub (events.txt)
 * - Crawls each event and extracts podiums
 * - Supports Solo & Double categories
 * - Correct URL patterns (-hyrox-men / -hyrox-doubles-men)
 * - Compatible with Render free-tier deployments
 */

import express from "express";
import fetch from "node-fetch";
import { chromium } from "playwright"; // ✅ stable import
import fs from "fs";

const app = express();
const PORT = process.env.PORT || 1000;
const EVENTS_SOURCE = "https://raw.githubusercontent.com/axsion/HyroxScraper/main/events.txt";
const CACHE_FILE = "./cache.json";

// Load cache if exists
let cache = [];
if (fs.existsSync(CACHE_FILE)) {
  cache = JSON.parse(fs.readFileSync(CACHE_FILE, "utf8"));
}

/** ------------------------
 * Helper: Save cache to file
 * ------------------------ */
function saveCache() {
  fs.writeFileSync(CACHE_FILE, JSON.stringify(cache, null, 2));
}

/** ------------------------
 * Helper: Fetch event list
 * ------------------------ */
async function fetchEventList() {
  const res = await fetch(EVENTS_SOURCE);
  const text = await res.text();
  const urls = text
    .split("\n")
    .map(l => l.trim())
    .filter(l => l.startsWith("https://"));
  return urls;
}

/** ------------------------
 * Scrape individual event
 * ------------------------ */
async function scrapeEvent(page, baseUrl) {
  const yearMatch = baseUrl.match(/(\d{4})/);
  const cityMatch = baseUrl.match(/ranking\/[^-]+-(\d{4})-(.*?)-hyrox/i);
  const year = yearMatch ? yearMatch[1] : "2025";
  const city = cityMatch ? cityMatch[2].toUpperCase() : "UNKNOWN";

  const categories = ["45-49", "50-54", "55-59", "60-64", "65-69", "70-74", "75-79"];
  const types = ["Solo", "Double"];
  const genders = ["men", "women", "mixed"];

  const added = [];

  for (const type of types) {
    for (const gender of genders) {
      for (const cat of categories) {
        // ✅ Correct URL pattern
        const url =
          type === "Double"
            ? `${baseUrl}-hyrox-doubles-${gender}?ag=${cat}`
            : `${baseUrl}-hyrox-${gender}?ag=${cat}`;

        console.log(`🔎 Visiting ${url}`);
        try {
          await page.goto(url, { timeout: 30000, waitUntil: "domcontentloaded" });
          await page.waitForSelector(".result-row", { timeout: 8000 });

          const podium = await page.$$eval(".result-row", rows =>
            rows.slice(0, 3).map(r => ({
              name: r.querySelector(".athlete-name")?.textContent?.trim() || "",
              time: r.querySelector(".athlete-time")?.textContent?.trim() || "",
            }))
          );

          if (!podium.length) {
            console.log(`⚠️ No results for ${url}`);
            continue;
          }

          const eventName = `Ranking of ${year} ${city} HYROX ${type.toUpperCase()} ${gender.toUpperCase()}`;
          const key = `${baseUrl}_${cat}_${type}_${gender}`;
          const record = { key, eventName, city, year, category: cat, gender, type, podium, url };

          if (!cache.find(e => e.key === key)) {
            cache.push(record);
            added.push(record);
            console.log(`✅ Added ${eventName} (${cat})`);
          } else {
            console.log(`⏩ Skipped existing ${eventName} (${cat})`);
          }
        } catch {
          console.log(`⚠️ Skipped ${url}`);
        }
      }
    }
  }

  saveCache();
  return added;
}

/** ------------------------
 * Full crawl
 * ------------------------ */
async function runFullScrape() {
  const urls = await fetchEventList();
  console.log(`🌍 Loaded ${urls.length} events from GitHub`);

  if (!urls.length) return { error: "No events loaded from GitHub" };

  let browser;
  try {
    console.log("🧭 Launching Chromium...");
    browser = await chromium.launch({ headless: true, args: ["--no-sandbox"] });
  } catch (err) {
    console.error("❌ Chromium failed to launch:", err.message);
    return { error: "Chromium failed to launch" };
  }

  const page = await browser.newPage();
  let addedCount = 0;

  for (const url of urls) {
    const added = await scrapeEvent(page, url);
    addedCount += added.length;
  }

  await browser.close();
  saveCache();
  return { added: addedCount, totalCache: cache.length };
}

/** ------------------------
 * Express routes
 * ------------------------ */

// ✅ Diagnostic
app.get("/api/check-events", async (req, res) => {
  try {
    const urls = await fetchEventList();
    const valid = urls.filter(u => u.startsWith("https://"));
    res.json({ valid: valid.length, invalid: urls.length - valid.length, urls: valid });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ✅ Run full scrape
app.get("/api/scrape-all", async (req, res) => {
  try {
    const result = await runFullScrape();
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ✅ Get cache
app.get("/api/last-run", (req, res) => res.json(cache));

// ✅ Clear cache
app.get("/api/clear-cache", (req, res) => {
  cache = [];
  saveCache();
  res.json({ status: "✅ Cache cleared" });
});

app.listen(PORT, () => {
  console.log(`🔥 HYROX Scraper v31.5 running on port ${PORT}`);
  console.log(`✅ Diagnostic route: /api/check-events`);
});
