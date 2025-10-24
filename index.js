/**
 * HYROX Doubles Scraper (v19.2)
 * -----------------------------------
 * • Adds missing Season 7 doubles only.
 * • Keeps existing Season 8 data intact.
 * • Detects Season 7 HTML structure automatically.
 * • Produces consistent {rank, name, time} output.
 */

import express from "express";
import fs from "fs";
import path from "path";
import { chromium } from "playwright";

const app = express();
const PORT = process.env.PORT || 10000;
const DATA_PATH = path.resolve("./data/last-run.json");
fs.mkdirSync(path.dirname(DATA_PATH), { recursive: true });

/* ---------------------------------------------------------------------------
   CONFIGURATION
--------------------------------------------------------------------------- */

const AGE_GROUPS = {
  s7: [
    "16-19", "20-24", "25-29", "30-34",
    "35-39", "40-44", "45-49",
    "50-59", "60-69", "70-79"
  ]
};

// ✅ Only S7 doubles URLs
const EVENT_URLS = [
  "https://www.hyresult.com/ranking/s7-2025-new-york-hyrox-doubles-men",
  "https://www.hyresult.com/ranking/s7-2025-new-york-hyrox-doubles-women",
  "https://www.hyresult.com/ranking/s7-2025-new-york-hyrox-doubles-mixed",

  "https://www.hyresult.com/ranking/s7-2025-rimini-hyrox-doubles-men",
  "https://www.hyresult.com/ranking/s7-2025-rimini-hyrox-doubles-women",
  "https://www.hyresult.com/ranking/s7-2025-rimini-hyrox-doubles-mixed",

  "https://www.hyresult.com/ranking/s7-2025-cardiff-hyrox-doubles-men",
  "https://www.hyresult.com/ranking/s7-2025-cardiff-hyrox-doubles-women",
  "https://www.hyresult.com/ranking/s7-2025-cardiff-hyrox-doubles-mixed",

  "https://www.hyresult.com/ranking/s7-2025-riga-hyrox-doubles-men",
  "https://www.hyresult.com/ranking/s7-2025-riga-hyrox-doubles-women",
  "https://www.hyresult.com/ranking/s7-2025-riga-hyrox-doubles-mixed",

  "https://www.hyresult.com/ranking/s7-2025-bangkok-hyrox-doubles-men",
  "https://www.hyresult.com/ranking/s7-2025-bangkok-hyrox-doubles-women",
  "https://www.hyresult.com/ranking/s7-2025-bangkok-hyrox-doubles-mixed",

  "https://www.hyresult.com/ranking/s7-2025-berlin-hyrox-doubles-men",
  "https://www.hyresult.com/ranking/s7-2025-berlin-hyrox-doubles-women",
  "https://www.hyresult.com/ranking/s7-2025-berlin-hyrox-doubles-mixed",

  "https://www.hyresult.com/ranking/s7-2025-incheon-hyrox-doubles-men",
  "https://www.hyresult.com/ranking/s7-2025-incheon-hyrox-doubles-women",
  "https://www.hyresult.com/ranking/s7-2025-incheon-hyrox-doubles-mixed",

  "https://www.hyresult.com/ranking/s7-2025-heerenveen-hyrox-doubles-men",
  "https://www.hyresult.com/ranking/s7-2025-heerenveen-hyrox-doubles-women",
  "https://www.hyresult.com/ranking/s7-2025-heerenveen-hyrox-doubles-mixed"
];

/* ---------------------------------------------------------------------------
   CACHE HANDLERS
--------------------------------------------------------------------------- */

function loadCache() {
  try {
    return JSON.parse(fs.readFileSync(DATA_PATH, "utf8"));
  } catch {
    return { events: [] };
  }
}

function saveCache(cache) {
  fs.writeFileSync(DATA_PATH, JSON.stringify(cache, null, 2));
}

/* ---------------------------------------------------------------------------
   SCRAPER — with S7 HTML fix
--------------------------------------------------------------------------- */

async function scrapeSingle(baseUrl, ageGroup) {
  const url = `${baseUrl}?ag=${ageGroup}`;
  const isSeason7 = /\/s7-/.test(url);
  console.log(`🔎 Scraping ${url}`);

  const browser = await chromium.launch({ headless: true, args: ["--no-sandbox"] });
  const page = await browser.newPage();

  try {
    await page.goto(url, { waitUntil: "networkidle", timeout: 60000 });
    await page.waitForTimeout(1500);

    const rows = await page.$$eval(
      "table tbody tr",
      (trs, isS7) =>
        trs.slice(0, 3).map(tr => {
          const tds = Array.from(tr.querySelectorAll("td")).map(td =>
            td.innerText.trim()
          );

          if (isS7) {
            // Season 7 doubles layout → names at col 4, time at col 5
            return {
              rank: tds[1] || "",
              name: tds[4] || "",
              time: tds[5] || ""
            };
          } else {
            // Standard (Season 8) fallback
            return {
              rank: tds[1] || "",
              name: tds[3] || "",
              time: tds[5] || ""
            };
          }
        }),
      isSeason7
    );

    await browser.close();
    return rows;
  } catch (err) {
    console.error(`❌ ${url}: ${err.message}`);
    await browser.close();
    return [];
  }
}

/* ---------------------------------------------------------------------------
   HELPERS
--------------------------------------------------------------------------- */

function parseEventMeta(url) {
  const match = url.match(/(s\d+)-(\d{4})-([\w-]+)-hyrox-(doubles-)?(\w+)/i);
  const season = match ? match[1] : "s7";
  const year = match ? match[2] : "2025";
  const city = match ? match[3].replace(/-/g, " ") : "";
  const type = /doubles/i.test(url) ? "Double" : "Solo";
  const gender = /men/i.test(url)
    ? "Men"
    : /women/i.test(url)
    ? "Women"
    : "Mixed";
  return { season, year, city, type, gender };
}

/* ---------------------------------------------------------------------------
   MAIN SCRAPE (Season 7 only, safe incremental)
--------------------------------------------------------------------------- */

async function scrapeSeason7Only() {
  const cache = loadCache();
  const seen = new Set(cache.events.map(e => e.url));
  const before = cache.events.length;

  for (const baseUrl of EVENT_URLS) {
    const { season, year, city, type, gender } = parseEventMeta(baseUrl);
    const ageGroups = AGE_GROUPS[season];

    for (const ag of ageGroups) {
      const fullUrl = `${baseUrl}?ag=${ag}`;
      if (seen.has(fullUrl)) {
        console.log(`⏩ Skipping cached ${fullUrl}`);
        continue;
      }

      const podium = await scrapeSingle(baseUrl, ag);
      if (!podium.length) continue;

      const eventName = `Ranking of ${year} ${city.toUpperCase()} HYROX ${type.toUpperCase()} ${gender.toUpperCase()}`;
      const event = {
        eventName,
        gender,
        category: ag,
        type,
        season,
        year,
        city,
        url: fullUrl,
        podium
      };

      cache.events.push(event);
      seen.add(fullUrl);
      saveCache(cache);
      console.log(`✅ Added ${eventName} (${ag})`);
      await new Promise(r => setTimeout(r, 800));
    }
  }

  console.log(`🎉 Added ${cache.events.length - before} new Season 7 events`);
  return cache;
}

/* ---------------------------------------------------------------------------
   EXPRESS ROUTES
--------------------------------------------------------------------------- */

app.get("/api/scrape-s7", async (_req, res) => {
  const cache = await scrapeSeason7Only();
  res.json({ ok: true, total: cache.events.length });
});

app.get("/api/last-run", (_req, res) => res.json(loadCache()));

app.listen(PORT, () =>
  console.log(`✅ HYROX Doubles S7 Scraper (v19.2) running on port ${PORT}`)
);
