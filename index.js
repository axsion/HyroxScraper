/**
 * HYROX Doubles Scraper (v19.4)
 * -----------------------------------
 * ✅ Crawls only Season 7 doubles events (Men, Women, Mixed)
 * ✅ Auto-detects header structure (different from S8)
 * ✅ Extracts proper athlete names & finish times
 * ✅ Incremental & restart-safe (keeps S8 data)
 * ✅ Output matches S8 format for Google Sheets
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

// ✅ Only S7 doubles URLs (S8 already done)
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
   UTILITIES
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
   SCRAPER — Header-Aware, Context-Safe
--------------------------------------------------------------------------- */
async function scrapeSingle(baseUrl, ageGroup) {
  const url = `${baseUrl}?ag=${ageGroup}`;
  console.log(`🔎 Scraping ${url}`);

  const browser = await chromium.launch({
    headless: true,
    args: ["--no-sandbox", "--disable-dev-shm-usage"]
  });
  const page = await browser.newPage();

  try {
    await page.goto(url, { waitUntil: "networkidle", timeout: 60000 });
    await page.waitForTimeout(1500);
    const isSeason7 = /\/s7-/.test(url);

    const result = await page.evaluate((isS7) => {
      // --- helpers must be defined inside browser context ---
      const looksLikeTime = (s) => /^\d{1,2}:\d{2}(:\d{2})?$/.test(s);
      const looksLikeNames = (s) => /,| & | \/ /.test(s) && /[A-Za-z]/.test(s);

      const table = document.querySelector("table");
      if (!table) return { rows: [] };

      const headerCells = Array.from(table.querySelectorAll("thead th"));
      const headers = headerCells.map((th) => th.textContent.trim().toLowerCase());
      console.log("🧩 Detected headers:", headers);

      const findIdx = (patterns) => {
        for (let i = 0; i < headers.length; i++) {
          for (const re of patterns) if (re.test(headers[i])) return i;
        }
        return -1;
      };

      const rankIdx = findIdx([/rank|pos|#/i]);
      const timeIdx = findIdx([/time|result|finish|chip/i]);
      let nameIdx = findIdx([/athlete|team|name/i]);

      const bodyRows = Array.from(table.querySelectorAll("tbody tr"));
      const firstThree = bodyRows.slice(0, 3);

      const parsed = firstThree.map((tr) => {
        const tds = Array.from(tr.querySelectorAll("td")).map((td) =>
          td.textContent.trim()
        );

        let timeVal =
          timeIdx >= 0 ? tds[timeIdx] || "" : tds.find(looksLikeTime) || "";
        let nameVal =
          nameIdx >= 0 ? tds[nameIdx] || "" : tds.find(looksLikeNames) || "";

        // S7 fix: sometimes name column replaced by age group
        if (isS7 && nameVal && /^\d{2}-\d{2}$/.test(nameVal)) {
          const alt = tds.find((s) => s !== nameVal && looksLikeNames(s));
          if (alt) nameVal = alt;
        }

        const rankVal =
          rankIdx >= 0 ? tds[rankIdx] || "" : tds.find((s) => /^\d+$/.test(s)) || "";

        return { rank: rankVal, name: nameVal, time: timeVal };
      });

      return { rows: parsed };
    }, isSeason7);

    await browser.close();

    const rows = (result && result.rows) || [];
    return rows
      .map((r) => ({
        rank: (r.rank || "").trim(),
        name: (r.name || "").trim(),
        time: (r.time || "").trim(),
      }))
      .filter((r) => r.name || r.time);
  } catch (err) {
    console.error(`❌ ${url}: ${err.message}`);
    await browser.close();
    return [];
  }
}

/* ---------------------------------------------------------------------------
   MAIN SCRAPE — Season 7 Only (Safe Incremental)
--------------------------------------------------------------------------- */
async function scrapeSeason7Only() {
  const cache = loadCache();
  const seen = new Set(cache.events.map((e) => e.url));
  const before = cache.events.length;

  for (const baseUrl of EVENT_URLS) {
    const { season, year, city, type, gender } = parseEventMeta(baseUrl);
    const ageGroups = AGE_GROUPS[season];
    if (!ageGroups) continue;

    for (const ag of ageGroups) {
      const fullUrl = `${baseUrl}?ag=${ag}`;
      if (seen.has(fullUrl)) {
        console.log(`⏩ Skipping cached ${fullUrl}`);
        continue;
      }

      const podium = await scrapeSingle(baseUrl, ag);
      if (!podium.length) {
        console.warn(`⚠️ No podium rows for ${fullUrl}`);
        continue;
      }

      const eventName = `Ranking of ${year} ${city.toUpperCase()} HYROX DOUBLES ${gender.toUpperCase()}`;

      const event = {
        eventName,
        gender,
        category: ag,
        type,
        season,
        year,
        city,
        url: fullUrl,
        podium,
      };

      cache.events.push(event);
      seen.add(fullUrl);
      saveCache(cache);
      console.log(`✅ Added ${eventName} (${ag})`);
      await new Promise((r) => setTimeout(r, 700));
    }
  }

  console.log(
    `🎉 Added ${cache.events.length - before} new Season 7 events (total: ${cache.events.length})`
  );
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
  console.log(`✅ HYROX Doubles S7 Scraper (v19.4) running on port ${PORT}`)
);
