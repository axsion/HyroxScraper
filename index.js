/**
 * HYROX Scraper v35.3
 * -------------------------------------------------------------
 * ✅ Render-friendly (no Playwright/Chromium)
 * ✅ Season-aware Masters groups: S8 vs S7
 * ✅ Strict URL patterns with -hyrox- (solo & doubles)
 * ✅ Routes:
 *    - GET /api/health
 *    - GET /api/check-events
 *    - GET /api/scrape-all   (runs full crawl)
 *    - GET /api/cache        (returns all cached podiums)
 * -------------------------------------------------------------
 */

import express from "express";
import fetch from "node-fetch";
import * as cheerio from "cheerio";

const app = express();
const PORT = process.env.PORT || 1000;
app.use(express.json({ limit: "10mb" }));

// ---------------- Cache (in-memory) ----------------
let cache = Object.create(null);

// ---------------- Config ----------------
const AGE_GROUPS = {
  s8: ["45-49","50-54","55-59","60-64","65-69","70-74","75-79"],
  s7: ["50-59","60-69"],
};

const EVENT_TYPES = [
  { key: "men",           label: "SOLO MEN" },
  { key: "women",         label: "SOLO WOMEN" },
  { key: "doubles-men",   label: "DOUBLE MEN" },
  { key: "doubles-women", label: "DOUBLE WOMEN" },
  { key: "doubles-mixed", label: "DOUBLE MIXED" },
];

const UA =
  "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/118 Safari/537.36";

// ---------------- Utils ----------------
async function loadEventList() {
  const url = "https://raw.githubusercontent.com/axsion/HyroxScraper/main/events.txt";
  const res = await fetch(url, { headers: { "User-Agent": UA } });
  if (!res.ok) throw new Error(`Failed to load events list (${res.status})`);
  const text = await res.text();
  return text.split(/\r?\n/).map(u => u.trim()).filter(u => u.startsWith("http"));
}

function parseEventUrl(u) {
  const m = u.match(/\/ranking\/(s\d+)-(\d{4})-([^/?#]+)/i);
  return {
    season: m?.[1]?.toLowerCase() || "s8",
    year: m?.[2] || "2025",
    city: (m?.[3] || "unknown").toUpperCase(),
  };
}

// Build the single correct URL for each (type, age)
function buildStrictUrl(base, typeKey, age) {
  const [maybeDoubles, maybeGender] = typeKey.split("-").length === 2
    ? typeKey.split("-")
    : ["doubles", typeKey]; // safety, but our keys are normalized

  if (typeKey.startsWith("doubles-")) {
    // doubles-men / doubles-women / doubles-mixed
    return `${base}-hyrox-doubles-${typeKey.split("-")[1]}?ag=${encodeURIComponent(age)}`;
  }
  // solo men / women
  return `${base}-hyrox-${typeKey}?ag=${encodeURIComponent(age)}`;
}

const sleep = (ms) => new Promise(r => setTimeout(r, ms));

function extractPodium(html) {
  const $ = cheerio.load(html);
  // Primary selector (observed live)
  let rows = $(".ranking-table tbody tr");
  // Fallback (if theme variants differ)
  if (!rows.length) rows = $(".table-ranking tbody tr");
  const podium = [];
  rows.slice(0, 3).each((_, row) => {
    const c = $(row).find("td");
    const name = $(c[1]).text().trim();
    const time = $(c[4]).text().trim();
    if (name && time) podium.push({ name, time });
  });
  return podium;
}

// ---------------- Core scraping ----------------
async function scrapeEvent(eventUrl) {
  const { season, year, city } = parseEventUrl(eventUrl);
  const groups = AGE_GROUPS[season] || AGE_GROUPS.s8;
  const results = [];

  for (const type of EVENT_TYPES) {
    for (const age of groups) {
      const key = `${season}_${year}_${city}_${type.key}_${age}`;
      if (cache[key]) continue;

      const url = buildStrictUrl(eventUrl, type.key, age);
      console.log("🔎", url);

      try {
        const res = await fetch(url, { headers: { "User-Agent": UA }, timeout: 25000 });
        if (!res.ok) {
          console.log(`⚠️ ${res.status} for ${url}`);
        } else {
          const html = await res.text();
          const podium = extractPodium(html);
          if (podium.length) {
            const data = {
              key,
              eventName: `Ranking of ${year} ${city} HYROX ${type.label}`,
              city,
              year,
              season,
              category: age,
              gender: type.key.includes("men")
                ? "Men"
                : type.key.includes("women")
                ? "Women"
                : "Mixed",
              type: type.key.includes("doubles") ? "Double" : "Solo",
              podium,
              url,
            };
            cache[key] = data;
            results.push(data);
            console.log(`✅ Added ${city} ${type.key} ${age}`);
          } else {
            console.log(`⚠️ No podium for ${city} ${type.key} ${age}`);
          }
        }
      } catch (e) {
        console.log(`⚠️ Error for ${url}: ${e.message}`);
      }

      // polite delay to avoid hammering the site
      await sleep(400);
    }
  }

  return results;
}

async function runFullScrape() {
  console.log("🌍 Starting full scrape...");
  const events = await loadEventList();
  let added = 0;
  for (const url of events) {
    const batch = await scrapeEvent(url);
    added += batch.length;
  }
  console.log(`🎯 Done. ${added} podiums added.`);
  return { added, total: Object.keys(cache).length };
}

// ---------------- API ----------------
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
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.get("/api/scrape-all", async (req, res) => {
  try {
    const result = await runFullScrape();
    res.json(result);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.get("/api/cache", (req, res) => {
  res.json({ events: Object.values(cache) });
});

// ---------------- Server ----------------
app.listen(PORT, () => {
  console.log(`🔥 HYROX Scraper v35.3 running on port ${PORT}`);
  console.log("✅ /api/health  ✅ /api/check-events  ✅ /api/scrape-all  ✅ /api/cache");
});
