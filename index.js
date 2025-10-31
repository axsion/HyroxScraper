/**
 * HYROX Scraper v37.0 – Render Free Tier (No Browser)
 * -------------------------------------------------------------
 * ✅ Parses data directly from window.__NUXT__ JSON
 * ✅ Works for all solo & doubles categories
 * ✅ No Playwright, no memory issues
 * ✅ Compatible with Google Sheets integration
 * -------------------------------------------------------------
 */

import express from "express";
import fetch from "node-fetch";

const app = express();
const PORT = process.env.PORT || 1000;
app.use(express.json({ limit: "10mb" }));

// ---------------- Cache ----------------
let cache = Object.create(null);

// ---------------- Config ----------------
const AGE_GROUPS = {
  s8: ["45-49", "50-54", "55-59", "60-64", "65-69", "70-74", "75-79"],
  s7: ["50-59", "60-69"]
};

const EVENT_TYPES = [
  { key: "men", label: "SOLO MEN" },
  { key: "women", label: "SOLO WOMEN" },
  { key: "doubles-men", label: "DOUBLE MEN" },
  { key: "doubles-women", label: "DOUBLE WOMEN" },
  { key: "doubles-mixed", label: "DOUBLE MIXED" }
];

const UA = "Mozilla/5.0 (X11; Linux x86_64; rv:118.0) Gecko/20100101 Firefox/118.0";

// ---------------- Helpers ----------------
async function loadEventList() {
  const url = "https://raw.githubusercontent.com/axsion/HyroxScraper/main/events.txt";
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Failed to load events list (${res.status})`);
  const text = await res.text();
  return text.split(/\r?\n/).map(u => u.trim()).filter(u => u.startsWith("http"));
}

function parseEventUrl(u) {
  const m = u.match(/\/ranking\/(s\d+)-(\d{4})-([^/?#]+)/i);
  return {
    season: m?.[1]?.toLowerCase() || "s8",
    year: m?.[2] || "2025",
    city: (m?.[3] || "unknown").toUpperCase()
  };
}

function buildStrictUrl(base, typeKey, age) {
  if (typeKey.startsWith("doubles-")) {
    const gender = typeKey.split("-")[1];
    return `${base}-hyrox-doubles-${gender}?ag=${encodeURIComponent(age)}`;
  } else {
    return `${base}-hyrox-${typeKey}?ag=${encodeURIComponent(age)}`;
  }
}

const sleep = (ms) => new Promise(r => setTimeout(r, ms));

// ---------------- Parser ----------------
function extractNuxtData(html) {
  const match = html.match(/window\.__NUXT__\s*=\s*(\{.*?\})<\/script>/s);
  if (!match) return null;
  try {
    return JSON.parse(match[1]);
  } catch (e) {
    console.log("⚠️ Failed to parse __NUXT__ JSON:", e.message);
    return null;
  }
}

function extractPodiumFromNuxt(nuxtData) {
  if (!nuxtData || !nuxtData.data || !Array.isArray(nuxtData.data)) return [];
  const root = nuxtData.data[0];
  if (!root) return [];

  // Look for an array that contains ranking info
  let rankingArray =
    root.ranking ||
    root.rankings ||
    root.results ||
    (root.page && root.page.ranking) ||
    [];

  if (!Array.isArray(rankingArray) || !rankingArray.length) return [];

  const podium = rankingArray.slice(0, 3).map((r) => ({
    name: r.name || r.fullName || r.athlete || "",
    time: r.time || r.result || r.finishTime || ""
  }));

  return podium.filter(p => p.name && p.time);
}

// ---------------- Scraper ----------------
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

      let podium = [];
      try {
        const res = await fetch(url, { headers: { "User-Agent": UA } });
        if (res.ok) {
          const html = await res.text();
          const nuxt = extractNuxtData(html);
          podium = extractPodiumFromNuxt(nuxt);
        }
      } catch (e) {
        console.log(`⚠️ Fetch failed: ${e.message}`);
      }

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
          url
        };
        cache[key] = data;
        results.push(data);
        console.log(`✅ Added ${city} ${type.key} ${age}`);
      } else {
        console.log(`⚠️ No podium for ${city} ${type.key} ${age}`);
      }

      await sleep(250);
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
    cacheCount: Object.keys(cache).length
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

// ---------------- Start ----------------
app.listen(PORT, () => {
  console.log(`🔥 HYROX Scraper v37.0 running on port ${PORT}`);
  console.log("✅ /api/health  ✅ /api/check-events  ✅ /api/scrape-all  ✅ /api/cache");
});
