/**
 * HYROX Season Scraper – v20.1 (Weekend + S7/S8 compatible)
 * ----------------------------------------------------------
 * Fetches podium results for HYROX Solo & Double events (Men/Women/Mixed)
 * and caches them in-memory (for Google Sheets integration).
 */

import express from "express";
import fetch from "node-fetch";
import { chromium } from "playwright";
import fs from "fs";

const app = express();
app.use(express.json());

const PORT = process.env.PORT || 10000;
const DATA_FILE = "./data/last-run.json";

// 🧠 In-memory cache
let cache = { events: [] };

// 🧱 Load cache at startup
if (fs.existsSync(DATA_FILE)) {
  cache = JSON.parse(fs.readFileSync(DATA_FILE, "utf8"));
  console.log(`✅ Loaded ${cache.events.length} cached events.`);
} else {
  console.log("ℹ️ No cache found, starting fresh.");
}

/* -----------------------------------------------------------
   🕷️  Scraper Core
----------------------------------------------------------- */

async function scrapeSingle(url) {
  console.log(`🔎 Scraping ${url}`);
  const browser = await chromium.launch({ headless: true, args: ["--no-sandbox"] });
  const page = await browser.newPage();

  try {
    await page.goto(url, { waitUntil: "networkidle", timeout: 60000 });
    await page.waitForTimeout(1500);

    const result = await page.evaluate(() => {
      const looksLikeTime = s => /^\d{1,2}:\d{2}(:\d{2})?$/.test(s);
      const looksLikeNames = s =>
        /[A-Za-z]/.test(s) &&
        !looksLikeTime(s) &&
        !/^(\d+|DNF|DQ|DSQ)$/i.test(s);

      const table = document.querySelector("table");
      if (!table) return { rows: [] };

      const bodyRows = Array.from(table.querySelectorAll("tbody tr"));
      const top3 = bodyRows.slice(0, 3);

      const parsed = top3.map(tr => {
        const tds = Array.from(tr.querySelectorAll("td"));
        const texts = tds.map(td => td.innerText.trim()).filter(Boolean);

        // 👀 improved name detection
        let nameVal = "";
        const nameCell =
          tds.find(td => td.querySelector("a") || td.className.match(/athlete|name/i)) ||
          null;
        if (nameCell) {
          nameVal = nameCell.innerText.trim();
        } else {
          const alt = texts.find(t => looksLikeNames(t) && t.length > 2);
          nameVal = alt || "";
        }

        const timeVal = texts.find(t => looksLikeTime(t)) || "";
        const rankVal = texts.find(t => /^\d+$/.test(t)) || "";

        return { rank: rankVal, name: nameVal, time: timeVal };
      });

      return { rows: parsed };
    });

    await browser.close();

    return result.rows
      .map(r => ({
        rank: (r.rank || "").trim(),
        name: (r.name || "").trim(),
        time: (r.time || "").trim(),
      }))
      .filter(r => r.name || r.time);
  } catch (err) {
    console.error(`❌ ${url}: ${err.message}`);
    await browser.close();
    return [];
  }
}

/* -----------------------------------------------------------
   🧩  Event Builders
----------------------------------------------------------- */

function buildEventList() {
  const baseUrls = [
    // --- SOLO ---
    "https://www.hyresult.com/ranking/s8-2025-paris-hyrox-men",
    "https://www.hyresult.com/ranking/s8-2025-paris-hyrox-women",
    "https://www.hyresult.com/ranking/s8-2025-birmingham-hyrox-men",
    "https://www.hyresult.com/ranking/s8-2025-birmingham-hyrox-women",

    // --- DOUBLES ---
    "https://www.hyresult.com/ranking/s8-2025-paris-hyrox-doubles-men",
    "https://www.hyresult.com/ranking/s8-2025-paris-hyrox-doubles-women",
    "https://www.hyresult.com/ranking/s8-2025-paris-hyrox-doubles-mixed",
    "https://www.hyresult.com/ranking/s8-2025-birmingham-hyrox-doubles-men",
    "https://www.hyresult.com/ranking/s8-2025-birmingham-hyrox-doubles-women",
    "https://www.hyresult.com/ranking/s8-2025-birmingham-hyrox-doubles-mixed",
  ];

  // Age groups for S8 + S7 style
  const ageGroups = [
    "16-24",
    "25-29",
    "30-34",
    "35-39",
    "40-44",
    "45-49",
    "50-54",
    "55-59",
    "60-64",
    "65-69",
    "70-74",
  ];

  const legacyAgeGroups = ["50-59", "60-69"];

  const urls = [];
  baseUrls.forEach(base => {
    const season = base.includes("/s7-") ? legacyAgeGroups : ageGroups;
    season.forEach(ag => urls.push(`${base}?ag=${ag}`));
  });

  return urls;
}

/* -----------------------------------------------------------
   ⚙️  Crawling Logic
----------------------------------------------------------- */

async function runFullScrape() {
  const urls = buildEventList();
  const newEvents = [];

  for (const url of urls) {
    const res = await scrapeSingle(url);
    if (!res.length) continue;

    const cityMatch = url.match(/s\d{1,2}-2025-(.*?)-hyrox/i);
    const city = cityMatch ? cityMatch[1].replace(/-/g, " ").toUpperCase() : "Unknown";

    const eventType = /double/i.test(url) ? "Double" : "Solo";
    const genderMatch =
      url.match(/(men|women|mixed)/i) || [];
    const gender = genderMatch[1] ? genderMatch[1].toUpperCase() : "UNKNOWN";

    const seasonMatch = url.match(/s(\d{1,2})-/);
    const season = seasonMatch ? seasonMatch[1] : "8";

    const eventName = `Ranking of 2025 ${city.toUpperCase()} HYROX ${
      eventType === "Double" ? "DOUBLES" : "SOLO"
    } ${gender}`;

    // extract age group from URL
    const agMatch = url.match(/\?ag=(\d{2}-\d{2})/);
    const category = agMatch ? agMatch[1] : "";

    newEvents.push({
      eventName,
      city,
      year: 2025,
      category,
      gender,
      type: eventType,
      podium: res,
      url,
      season,
    });
  }

  // Avoid duplicates
  const existingKeys = new Set(
    cache.events.map(e => `${e.eventName}_${e.category}`)
  );

  const filtered = newEvents.filter(
    e => !existingKeys.has(`${e.eventName}_${e.category}`)
  );

  cache.events.push(...filtered);

  fs.mkdirSync("./data", { recursive: true });
  fs.writeFileSync(DATA_FILE, JSON.stringify(cache, null, 2));

  console.log(
    `✅ Added ${filtered.length} new events (total ${cache.events.length}).`
  );
  return filtered;
}

/* -----------------------------------------------------------
   🧭  API Routes
----------------------------------------------------------- */

app.get("/api/scrape-weekend", async (req, res) => {
  try {
    const newData = await runFullScrape();
    res.json({ added: newData.length, events: newData });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get("/api/last-run", (req, res) => {
  res.json(cache);
});

app.post("/api/set-initial-cache", (req, res) => {
  const { events } = req.body;
  if (events && Array.isArray(events)) {
    cache.events = events;
    fs.mkdirSync("./data", { recursive: true });
    fs.writeFileSync(DATA_FILE, JSON.stringify(cache, null, 2));
    res.json({ ok: true, count: events.length });
  } else {
    res.status(400).json({ error: "Invalid cache payload" });
  }
});

/* -----------------------------------------------------------
   🚀  Start Server
----------------------------------------------------------- */

app.listen(PORT, () =>
  console.log(`🔥 HYROX scraper running on port ${PORT}`)
);
