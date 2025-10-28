/**
 * HYROX Weekend Results Scraper
 * --------------------------------
 * Targets the latest 2 competitions (Solo + Doubles) for a given weekend.
 * Solo: Men & Women
 * Doubles: Men, Women & Mixed
 * Incremental caching — will not re-scrape already captured URLs.
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

// Define the URLs you want to scrape this weekend
const EVENT_URLS = [
  // SOLO (Men + Women) example
  "https://www.hyresult.com/ranking/s8-2025-paris-hyrox-men",
  "https://www.hyresult.com/ranking/s8-2025-paris-hyrox-women",

  "https://www.hyresult.com/ranking/s8-2025-birmingham-hyrox-men",
  "https://www.hyresult.com/ranking/s8-2025-birmingham-hyrox-women",

  // DOUBLES (Men, Women & Mixed)
  "https://www.hyresult.com/ranking/s8-2025-paris-hyrox-doubles-men",
  "https://www.hyresult.com/ranking/s8-2025-paris-hyrox-doubles-women",
  "https://www.hyresult.com/ranking/s8-2025-paris-hyrox-doubles-mixed",

  "https://www.hyresult.com/ranking/s8-2025-birmingham-hyrox-doubles-men",
  "https://www.hyresult.com/ranking/s8-2025-birmingham-hyrox-doubles-women",
  "https://www.hyresult.com/ranking/s8-2025-birmingham-hyrox-doubles-mixed"
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
   UTILITIES
--------------------------------------------------------------------------- */
function parseEventMeta(url) {
  const m = url.match(/(s\d+)-(\d{4})-([\w-]+)-hyrox-(doubles-)?(\w+)/i);
  const season = m ? m[1] : "";
  const year = m ? m[2] : "";
  const city = m ? m[3].replace(/-/g, " ") : "";
  const type = /doubles/i.test(url) ? "Double" : "Solo";
  const gender = /men/i.test(url)
    ? "Men"
    : /women/i.test(url)
    ? "Women"
    : /Mixed/;  // for mixed doubles
  return { season, year, city, type, gender };
}

function looksLikeTime(s) {
  return /^\d{1,2}:\d{2}(:\d{2})?$/.test(s);
}
function looksLikeNames(s) {
  return /,| & | \/ /.test(s) && /[A-Za-z]/.test(s);
}

/* ---------------------------------------------------------------------------
   SCRAPER (header‐aware)
--------------------------------------------------------------------------- */
async function scrapeSingle(url) {
  console.log(`🔎 Scraping ${url}`);
  const browser = await chromium.launch({ headless: true, args: ["--no-sandbox"] });
  const page = await browser.newPage();

  try {
    await page.goto(url, { waitUntil: "networkidle", timeout: 60000 });
    await page.waitForTimeout(1500);

    const result = await page.evaluate(() => {
      const looksLikeTime = (s) => /^\d{1,2}:\d{2}(:\d{2})?$/.test(s);
      const looksLikeNames = (s) => /,| & | \/ /.test(s) && /[A-Za-z]/.test(s);

      const table = document.querySelector("table");
      if (!table) return { rows: [] };

      const headerCells = Array.from(table.querySelectorAll("thead th"));
      const headers = headerCells.map((th) => th.textContent.trim().toLowerCase());

      const findIdx = (preds) => {
        for (let i = 0; i < headers.length; i++) {
          for (const re of preds) { if (re.test(headers[i])) return i; }
        }
        return -1;
      };

      const rankIdx = findIdx([/rank|pos|#/i]);
      const timeIdx = findIdx([/time|result|finish/i]);
      let nameIdx = findIdx([/athlete|team|name/i]);

      const bodyRows = Array.from(table.querySelectorAll("tbody tr"));
      const top3 = bodyRows.slice(0, 3);

      const parsed = top3.map(tr => {
        const tds = Array.from(tr.querySelectorAll("td")).map(td => td.textContent.trim());
        let timeVal = timeIdx >= 0 ? (tds[timeIdx] || "") : (tds.find(looksLikeTime) || "");
        let nameVal = nameIdx >= 0 ? (tds[nameIdx] || "") : (tds.find(looksLikeNames) || "");
        let rankVal = rankIdx >= 0 ? (tds[rankIdx] || "") : (tds.find(s => /^\d+$/.test(s)) || "");
        return { rank: rankVal, name: nameVal, time: timeVal };
      });

      return { rows: parsed };
    });

    await browser.close();

    const cleaned = result.rows.map(r => ({
      rank: (r.rank || "").trim(),
      name: (r.name || "").trim(),
      time: (r.time || "").trim()
    })).filter(r => r.name || r.time);

    return cleaned;
  } catch (err) {
    console.error(`❌ ${url}: ${err.message}`);
    await browser.close();
    return [];
  }
}

/* ---------------------------------------------------------------------------
   MAIN SCRAPE
--------------------------------------------------------------------------- */
async function scrapeEvents() {
  const cache = loadCache();
  const seen = new Set(cache.events.map(e => e.url));

  for (const url of EVENT_URLS) {
    if (seen.has(url)) {
      console.log(`⏩ Skipping cached ${url}`);
      continue;
    }

    const { season, year, city, type, gender } = parseEventMeta(url);
    const podium = await scrapeSingle(url);
    if (!podium.length) {
      console.warn(`⚠️ No podium for ${url}`);
      continue;
    }

    const eventName = `Ranking of ${year} ${city.toUpperCase()} HYROX ${type.toUpperCase()} ${gender.toUpperCase()}`;

    const event = {
      eventName,
      gender,
      category: "",    // you may fill AG if needed
      type,
      season,
      year,
      city,
      url,
      podium
    };

    cache.events.push(event);
    seen.add(url);
    saveCache(cache);
    console.log(`✅ Added ${eventName}`);
    await new Promise(r => setTimeout(r, 700));
  }

  console.log(`🎉 Completed. Total cached events: ${cache.events.length}`);
  return cache;
}

/* ---------------------------------------------------------------------------
   ROUTES
--------------------------------------------------------------------------- */
app.get("/api/scrape-weekend", async (_req, res) => {
  const cache = await scrapeEvents();
  res.json({ ok: true, total: cache.events.length });
});
app.get("/api/last-run", (_req, res) => res.json(loadCache()));

app.listen(PORT, () => {
  console.log(`✅ Weekend HYROX Scraper running on port ${PORT}`);
});
