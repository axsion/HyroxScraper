/**
 * HYROX Scraper v34.2 (Static HTML Edition, Season-aware age groups)
 * -------------------------------------------------------------
 * ✅ Render-friendly (no Chromium / Playwright)
 * ✅ node-fetch + Cheerio static scraping
 * ✅ Auto-detects season from URL (s7 vs s8) and applies correct age groups
 * ✅ API:
 *    - GET /api/health
 *    - GET /api/check-events
 *    - GET /api/scrape-all
 * -------------------------------------------------------------
 */

import express from "express";
import fetch from "node-fetch";
import * as cheerio from "cheerio";

const app = express();
const PORT = process.env.PORT || 1000;

app.use(express.json({ limit: "10mb" }));

// ==============================
// Cache (avoid duplicates)
// ==============================
let cache = Object.create(null);

// ==============================
// Load event URLs (from GitHub)
// ==============================
async function loadEventList() {
  const url = "https://raw.githubusercontent.com/axsion/HyroxScraper/main/events.txt";
  console.log("📄 Loading event URLs from:", url);
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Failed to load events list (${res.status})`);
  const text = await res.text();
  const urls = text
    .split(/\r?\n/)
    .map((u) => u.trim())
    .filter((u) => u.startsWith("http"));
  console.log(`🌍 Loaded ${urls.length} event URLs`);
  return urls;
}

// ==============================
// Season-aware age groups
// ==============================
// Define the canonical age groups per season.
// Add more seasons here if needed.
const AGE_GROUPS_BY_SEASON = {
  s8: ["45-49", "50-54", "55-59", "60-64", "65-69", "70-74", "75-79"],
  s7: ["50-59", "60-69"],
};

// Default (fallback) if we cannot detect season reliably.
const DEFAULT_AGE_GROUPS = AGE_GROUPS_BY_SEASON.s8;

// Event types (Solo/Doubles)
// Keep keys aligned with hyresult URL suffixes.
const EVENT_TYPES = [
  { key: "men",           label: "SOLO MEN" },
  { key: "women",         label: "SOLO WOMEN" },
  { key: "doubles-men",   label: "DOUBLE MEN" },
  { key: "doubles-women", label: "DOUBLE WOMEN" },
  { key: "doubles-mixed", label: "DOUBLE MIXED" },
];

// Parse season, year, city from a hyresult URL like:
// https://www.hyresult.com/ranking/s8-2025-valencia
function parseMetaFromEventUrl(eventUrl) {
  // capture: s8 | s7, year, city
  const m = eventUrl.match(/\/ranking\/(s\d+)-(\d{4})-([^/?#]+)/i);
  const season = m?.[1]?.toLowerCase() || null; // "s8" | "s7"
  const year   = m?.[2] || null;
  const city   = m?.[3]?.replace(/-/g, " ") || null;
  return { season, year, city };
}

function getAgeGroupsForSeason(season) {
  if (!season) return DEFAULT_AGE_GROUPS;
  if (AGE_GROUPS_BY_SEASON[season]) return AGE_GROUPS_BY_SEASON[season];
  // Unknown season? default to s8 style (more granular)
  return DEFAULT_AGE_GROUPS;
}

// ==============================
// Scrape one event (static HTML)
// ==============================
async function scrapeEvent(eventUrl) {
  const results = [];
  const { season, year, city } = parseMetaFromEventUrl(eventUrl);

  const cityLabel = city ? city.toUpperCase() : "UNKNOWN";
  const yearLabel = year || "2025"; // sensible fallback
  const ageGroups = getAgeGroupsForSeason(season);

  for (const type of EVENT_TYPES) {
    for (const age of ageGroups) {
      const url = `${eventUrl}-${type.key}?ag=${encodeURIComponent(age)}`;
      const key = `${season || "s?"}_${yearLabel}_${cityLabel}_${age}_${type.key}`;

      if (cache[key]) {
        console.log(`⏩ Skipped cached ${key}`);
        continue;
      }

      console.log("🔎 Fetching", url);
      try {
        const res = await fetch(url, { timeout: 20000 });
        if (!res.ok) {
          console.log(`⚠️ Failed to load ${url} (${res.status})`);
          continue;
        }

        const html = await res.text();
        const $ = cheerio.load(html);

        // Top 3 rows in the ranking table
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
            eventName: `Ranking of ${yearLabel} ${cityLabel} HYROX ${type.label}`,
            city: cityLabel,
            year: yearLabel,
            season: season || "unknown",
            category: age,
            gender: type.key.includes("men")
              ? "Men"
              : type.key.includes("women")
              ? "Women"
              : "Mixed",
            type: type.key.includes("double") ? "Double" : "Solo",
            podium,
            url,
          };
          results.push(data);
          cache[key] = data;
          console.log(`✅ Added ${data.eventName} (${age}) [${type.label}]`);
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

// ==============================
// Run full scrape
// ==============================
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

// ==============================
// API Routes
// ==============================
app.get("/api/health", (req, res) => {
  res.json({
    status: "ok",
    service: "HYROX Scraper",
    node: process.version,
    time: new Date().toISOString(),
    cacheCount: Object.keys(cache).length,
  });
});

app.get("/api/check-events", async (req, res) => {
  try {
    const urls = await loadEventList();
    res.json({ total: urls.length, sample: urls.slice(0, 5) });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get("/api/scrape-all", async (req, res) => {
  try {
    const result = await runFullScrape();
    res.json(result);
  } catch (err) {
    console.error("❌ Scrape error:", err.message);
    res.status(500).json({ error: err.message });
  }
});

// ==============================
// Server
// ==============================
app.listen(PORT, () => {
  console.log(`🔥 HYROX Scraper v34.2 running on port ${PORT}`);
  console.log(`✅ Health check: /api/health`);
  console.log(`✅ Event check: /api/check-events`);
  console.log(`✅ Full scrape: /api/scrape-all`);
});
