/**
 * HYROX Scraper v35.0
 * -------------------------------------------------------------
 * ✅ Render-friendly (no Playwright)
 * ✅ Crawls all SOLO & DOUBLE categories for S7 + S8
 * ✅ Exposes:
 *    /api/health
 *    /api/check-events
 *    /api/scrape-all
 *    /api/cache        → for Google Sheets integration
 * -------------------------------------------------------------
 */

import express from "express";
import fetch from "node-fetch";
import * as cheerio from "cheerio";

const app = express();
const PORT = process.env.PORT || 1000;
app.use(express.json({ limit: "10mb" }));

// ---------------- Cache ----------------
let cache = Object.create(null);

// ---------------- Load events ----------------
async function loadEventList() {
  const url = "https://raw.githubusercontent.com/axsion/HyroxScraper/main/events.txt";
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Failed to load events list (${res.status})`);
  const text = await res.text();
  return text.split(/\r?\n/).map(u => u.trim()).filter(u => u.startsWith("http"));
}

// ---------------- Season config ----------------
const AGE_GROUPS = {
  s8: ["45-49","50-54","55-59","60-64","65-69","70-74","75-79"],
  s7: ["50-59","60-69"]
};
const EVENT_TYPES = [
  { key:"men",label:"SOLO MEN" },
  { key:"women",label:"SOLO WOMEN" },
  { key:"doubles-men",label:"DOUBLE MEN" },
  { key:"doubles-women",label:"DOUBLE WOMEN" },
  { key:"doubles-mixed",label:"DOUBLE MIXED" }
];

// Parse metadata
function parseEventUrl(u) {
  const m = u.match(/\/ranking\/(s\d+)-(\d{4})-([^/?#]+)/i);
  return {
    season: m?.[1]?.toLowerCase() || "s8",
    year: m?.[2] || "2025",
    city: (m?.[3] || "unknown").toUpperCase()
  };
}

function buildUrls(base, type, age) {
  return [
    `${base}-hyrox-${type}?ag=${encodeURIComponent(age)}`,
    `${base}-${type}?ag=${encodeURIComponent(age)}`
  ];
}

// Extract podium
function extractPodium(html) {
  const $ = cheerio.load(html);
  const rows = $(".ranking-table tbody tr").slice(0, 3);
  const podium = [];
  rows.each((i, row) => {
    const c = $(row).find("td");
    const name = $(c[1]).text().trim();
    const time = $(c[4]).text().trim();
    if (name && time) podium.push({ name, time });
  });
  return podium;
}

// ---------------- Scrape single event ----------------
async function scrapeEvent(eventUrl) {
  const { season, year, city } = parseEventUrl(eventUrl);
  const groups = AGE_GROUPS[season] || AGE_GROUPS.s8;
  const results = [];

  for (const type of EVENT_TYPES) {
    for (const age of groups) {
      const key = `${season}_${year}_${city}_${type.key}_${age}`;
      if (cache[key]) continue;
      let found = false;

      for (const url of buildUrls(eventUrl, type.key, age)) {
        try {
          console.log("🔎", url);
          const res = await fetch(url, { timeout: 20000 });
          if (!res.ok) continue;
          const html = await res.text();
          const podium = extractPodium(html);
          if (podium.length) {
            const data = {
              key,
              eventName: `Ranking of ${year} ${city} HYROX ${type.label}`,
              city, year, season, category: age,
              gender: type.key.includes("men")
                ? "Men"
                : type.key.includes("women")
                ? "Women"
                : "Mixed",
              type: type.key.includes("double") ? "Double" : "Solo",
              podium, url
            };
            cache[key] = data;
            results.push(data);
            console.log(`✅ Added ${data.eventName} (${age})`);
            found = true;
            break;
          }
        } catch (e) {
          console.log("⚠️", e.message);
        }
      }
      if (!found) console.log(`⚠️ No podium for ${city} ${type.key} ${age}`);
    }
  }
  return results;
}

// ---------------- Full scrape ----------------
async function runFullScrape() {
  console.log("🌍 Starting full scrape...");
  const events = await loadEventList();
  let added = 0;
  for (const url of events) added += (await scrapeEvent(url)).length;
  console.log(`🎯 Done. ${added} podiums found.`);
  return { added, total: Object.keys(cache).length };
}

// ---------------- API routes ----------------
app.get("/api/health", (req, res) => {
  res.json({ status: "ok", service: "HYROX Scraper", node: process.version,
             time: new Date().toISOString(), cacheCount: Object.keys(cache).length });
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

// For Google Sheets
app.get("/api/cache", (req, res) => {
  res.json({ events: Object.values(cache) });
});

// ---------------- Start ----------------
app.listen(PORT, () => {
  console.log(`🔥 HYROX Scraper v35.0 on port ${PORT}`);
  console.log("✅ /api/health  ✅ /api/check-events  ✅ /api/scrape-all  ✅ /api/cache");
});
