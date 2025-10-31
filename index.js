/**
 * HYROX Scraper v34.0 (Static HTML Edition)
 * -------------------------------------------------------------
 * ✅ Render-friendly (no Chromium / Playwright)
 * ✅ Uses node-fetch + Cheerio for static scraping
 * ✅ Reads event list dynamically from GitHub events.txt
 * ✅ Provides same API routes:
 *    - /api/health
 *    - /api/check-events
 *    - /api/scrape-all
 * -------------------------------------------------------------
 */

import express from "express";
import fetch from "node-fetch";
import cheerio from "cheerio";

const app = express();
const PORT = process.env.PORT || 1000;

app.use(express.json({ limit: "10mb" }));

// Cached results to avoid duplicate scraping
let cache = {};

// =======================================================
// 🔹 Load event URLs from GitHub
// =======================================================
async function loadEventList() {
  const url =
    "https://raw.githubusercontent.com/axsion/HyroxScraper/main/events.txt";
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
// 🔹 Constants
// =======================================================
const MASTER_AGE_GROUPS = [
  "45-49",
  "50-54",
  "55-59",
  "60-64",
  "65-69",
  "70-74",
  "75-79",
  "50-59",
  "60-69"
];

const EVENT_TYPES = [
  { key: "men", label: "SOLO MEN" },
  { key: "women", label: "SOLO WOMEN" },
  { key: "doubles-men", label: "DOUBLE MEN" },
  { key: "doubles-women", label: "DOUBLE WOMEN" },
  { key: "doubles-mixed", label: "DOUBLE MIXED" }
];

// =======================================================
// 🔹 Scrape one event (static HTML parsing)
// =======================================================
async function scrapeEvent(eventUrl) {
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

      console.log("🔎 Fetching", url);
      try {
        const res = await fetch(url, { timeout: 15000 });
        if (!res.ok) {
          console.log(`⚠️ Failed to load ${url} (${res.status})`);
          continue;
        }
        const html = await res.text();
        const $ = cheerio.load(html);

        // parse top 3 rows in .ranking-table
        const rows = $(".ranking-table tbody tr").slice(0, 3);
        const podium = [];
        rows.each((i, row) => {
          const cells = $(row).find("td");
          const name = $(cells[1]).text().trim();
          const time = $(cells[4]).text().trim();
          if (name && time) podium.push({ name, time });
        });

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
        console.log(`⚠️ Error scraping ${url}: ${err.message}`);
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

  let added = 0;
  for (const eventUrl of eventUrls) {
    const results = await scrapeEvent(eventUrl);
    added += results.length;
  }

  console.log(`🎯 Completed scrape — ${added} new podiums added.`);
  return { added, totalCache: Object.keys(cache).length };
}

// =======================================================
// 🔹 API Routes
// =======================================================

// Health check
app.get("/api/health", (req, res) => {
  res.json({
    status: "ok",
    service: "HYROX Scraper",
    node: process.version,
    time: new Date().toISOString(),
    cacheCount: Object.keys(cache).length
  });
});

// Event list diagnostic
app.get("/api/check-events", async (req, res) => {
  try {
    const urls = await loadEventList();
    res.json({ total: urls.length, sample: urls.slice(0, 5) });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Full scrape
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
  console.log(`🔥 HYROX Scraper v34.0 running on port ${PORT}`);
  console.log(`✅ Health check: /api/health`);
  console.log(`✅ Event check: /api/check-events`);
  console.log(`✅ Full scrape: /api/scrape-all`);
});
