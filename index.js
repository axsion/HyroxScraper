/**
 * HYROX Podium Scraper v6 — Full Season Scraper (Solo Masters)
 * Frederic Bergeron | October 2025
 *
 * ✅ Scrapes all ?ag=45-49 ... 75-79 for each event
 * ✅ Fixes "Analyze" issue by detecting time pattern cell
 * ✅ Adds /api/scrape-all to crawl entire season with rate limiting
 */

import express from "express";
import fs from "fs";
import path from "path";
import { chromium } from "playwright";

const app = express();
const PORT = process.env.PORT || 10000;
const DATA_FILE = path.resolve("./data/last-run.json");

/* -------------------------------------------------------------------------- */
/*                          1. Base Event URLs (Solo)                         */
/* -------------------------------------------------------------------------- */

const EVENT_BASE_URLS = [
  "https://www.hyresult.com/ranking/s8-2025-valencia-hyrox-men",
  "https://www.hyresult.com/ranking/s8-2025-valencia-hyrox-women",
  "https://www.hyresult.com/ranking/s8-2025-gdansk-hyrox-men",
  "https://www.hyresult.com/ranking/s8-2025-gdansk-hyrox-women",
  "https://www.hyresult.com/ranking/s8-2025-geneva-hyrox-men",
  "https://www.hyresult.com/ranking/s8-2025-geneva-hyrox-women",
  "https://www.hyresult.com/ranking/s8-2025-hamburg-hyrox-men",
  "https://www.hyresult.com/ranking/s8-2025-hamburg-hyrox-women",
  "https://www.hyresult.com/ranking/s8-2025-toronto-hyrox-men",
  "https://www.hyresult.com/ranking/s8-2025-toronto-hyrox-women",
  "https://www.hyresult.com/ranking/s8-2025-oslo-hyrox-men",
  "https://www.hyresult.com/ranking/s8-2025-oslo-hyrox-women",
  "https://www.hyresult.com/ranking/s8-2025-rome-hyrox-men",
  "https://www.hyresult.com/ranking/s8-2025-rome-hyrox-women",
  "https://www.hyresult.com/ranking/s8-2025-boston-hyrox-men",
  "https://www.hyresult.com/ranking/s8-2025-boston-hyrox-women",
  "https://www.hyresult.com/ranking/s8-2025-maastricht-hyrox-men",
  "https://www.hyresult.com/ranking/s8-2025-maastricht-hyrox-women",
  "https://www.hyresult.com/ranking/s8-2025-sao-paulo-hyrox-men",
  "https://www.hyresult.com/ranking/s8-2025-sao-paulo-hyrox-women",
  "https://www.hyresult.com/ranking/s8-2025-acapulco-hyrox-men",
  "https://www.hyresult.com/ranking/s8-2025-acapulco-hyrox-women",
  "https://www.hyresult.com/ranking/s8-2025-perth-hyrox-men",
  "https://www.hyresult.com/ranking/s8-2025-perth-hyrox-women",
  "https://www.hyresult.com/ranking/s8-2025-mumbai-hyrox-men",
  "https://www.hyresult.com/ranking/s8-2025-mumbai-hyrox-women",
  "https://www.hyresult.com/ranking/s8-2025-beijing-hyrox-men",
  "https://www.hyresult.com/ranking/s8-2025-beijing-hyrox-women",
  "https://www.hyresult.com/ranking/s8-2025-yokohama-hyrox-men",
  "https://www.hyresult.com/ranking/s8-2025-yokohama-hyrox-women",
  "https://www.hyresult.com/ranking/s8-2025-hong-kong-hyrox-men",
  "https://www.hyresult.com/ranking/s8-2025-hong-kong-hyrox-women",
  "https://www.hyresult.com/ranking/s8-2025-cape-town-hyrox-men",
  "https://www.hyresult.com/ranking/s8-2025-cape-town-hyrox-women",
  "https://www.hyresult.com/ranking/s8-2025-new-delhi-hyrox-men",
  "https://www.hyresult.com/ranking/s8-2025-new-delhi-hyrox-women",
  "https://www.hyresult.com/ranking/s8-2025-abu-dhabi-hyrox-men",
  "https://www.hyresult.com/ranking/s8-2025-abu-dhabi-hyrox-women",
  "https://www.hyresult.com/ranking/s8-2025-sydney-hyrox-men",
  "https://www.hyresult.com/ranking/s8-2025-sydney-hyrox-women",
  "https://www.hyresult.com/ranking/s8-2025-singapore-hyrox-men",
  "https://www.hyresult.com/ranking/s8-2025-singapore-hyrox-women",
  "https://www.hyresult.com/ranking/s7-2025-new-york-hyrox-men",
  "https://www.hyresult.com/ranking/s7-2025-new-york-hyrox-women",
  "https://www.hyresult.com/ranking/s7-2025-rimini-hyrox-men",
  "https://www.hyresult.com/ranking/s7-2025-rimini-hyrox-women",
  "https://www.hyresult.com/ranking/s7-2025-cardiff-hyrox-men",
  "https://www.hyresult.com/ranking/s7-2025-cardiff-hyrox-women",
  "https://www.hyresult.com/ranking/s7-2025-riga-hyrox-men",
  "https://www.hyresult.com/ranking/s7-2025-riga-hyrox-women",
  "https://www.hyresult.com/ranking/s7-2025-bangkok-hyrox-men",
  "https://www.hyresult.com/ranking/s7-2025-bangkok-hyrox-women",
  "https://www.hyresult.com/ranking/s7-2025-berlin-hyrox-men",
  "https://www.hyresult.com/ranking/s7-2025-berlin-hyrox-women",
  "https://www.hyresult.com/ranking/s7-2025-incheon-hyrox-men",
  "https://www.hyresult.com/ranking/s7-2025-incheon-hyrox-women",
  "https://www.hyresult.com/ranking/s7-2025-heerenveen-hyrox-men",
  "https://www.hyresult.com/ranking/s7-2025-heerenveen-hyrox-women"
];

/* -------------------------------------------------------------------------- */
/*                         2. Master Age Groups                               */
/* -------------------------------------------------------------------------- */

const AGE_GROUPS = ["45-49", "50-54", "55-59", "60-64", "65-69", "70-74", "75-79"];

/* -------------------------------------------------------------------------- */
/*                                 3. Routes                                  */
/* -------------------------------------------------------------------------- */

app.get("/api/health", (_, res) => res.json({ ok: true }));

app.get("/api/last-run", (_, res) => {
  if (fs.existsSync(DATA_FILE)) return res.json(JSON.parse(fs.readFileSync(DATA_FILE, "utf8")));
  res.json({ events: [] });
});

/**
 * /api/scrape?url=<base_event_url>
 * Iterates through all Master ?ag categories automatically
 */
app.get("/api/scrape", async (req, res) => {
  const baseUrl = req.query.url;
  if (!baseUrl) return res.status(400).json({ error: "Missing ?url=" });

  const results = await scrapeEvent(baseUrl);
  res.json({ count: results.length, events: results });
});

/**
 * /api/scrape-all?limit=N
 * Sequentially scrapes all events (and all Masters) with safe rate limiting
 */
app.get("/api/scrape-all", async (req, res) => {
  const limit = Number(req.query.limit) || EVENT_BASE_URLS.length;
  const subset = EVENT_BASE_URLS.slice(0, limit);
  const allResults = [];

  for (const url of subset) {
    console.log(`🏁 Scraping base event: ${url}`);
    const results = await scrapeEvent(url);
    allResults.push(...results);
    await delay(5000); // wait 5 seconds between events to avoid rate-limit
  }

  // Save everything
  const cache = { scrapedAt: new Date().toISOString(), events: allResults };
  fs.mkdirSync(path.dirname(DATA_FILE), { recursive: true });
  fs.writeFileSync(DATA_FILE, JSON.stringify(cache, null, 2));

  res.json({ totalEvents: allResults.length, message: "✅ Full season scrape complete" });
});

/* -------------------------------------------------------------------------- */
/*                               4. Scraper                                   */
/* -------------------------------------------------------------------------- */

async function scrapeEvent(baseUrl) {
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();
  const results = [];

  try {
    for (const ag of AGE_GROUPS) {
      const fullUrl = `${baseUrl}?ag=${ag}`;
      console.log(`🔎 Scraping ${fullUrl}`);
      const data = await scrapeCategory(page, fullUrl, ag);
      if (data) results.push(data);
    }
  } catch (err) {
    console.error(`❌ Error scraping ${baseUrl}:`, err);
  } finally {
    await browser.close();
  }
  return results;
}

async function scrapeCategory(page, url, ageGroup) {
  try {
    await page.goto(url, { waitUntil: "domcontentloaded", timeout: 60000 });
    const eventName = await page.title();

    const podium = await page.$$eval("table tbody tr", rows =>
      Array.from(rows)
        .slice(0, 3)
        .map(r => {
          const tds = Array.from(r.querySelectorAll("td"));
          const rank = tds[0]?.innerText.trim();
          const name = tds[1]?.innerText.trim();
          const timeCell = tds.find(td => /\d{1,2}:\d{2}:\d{2}|\d{1,2}:\d{2}/.test(td.innerText));
          const time = timeCell ? timeCell.innerText.trim() : "";
          return { rank, name, ageGroup, time };
        })
        .filter(r => r.name && r.time)
    );

    if (!podium.length) return null;

    const gender = /WOMEN/i.test(eventName) ? "Women" : "Men";
    return { eventName, gender, category: ageGroup, url, podium };
  } catch (err) {
    console.log(`⚠️ Failed ${url}: ${err.message}`);
    return null;
  }
}

/* -------------------------------------------------------------------------- */
/*                            5. Utility functions                            */
/* -------------------------------------------------------------------------- */

function delay(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

/* -------------------------------------------------------------------------- */
/*                                6. Start App                                */
/* -------------------------------------------------------------------------- */

app.listen(PORT, () => console.log(`✅ HYROX Masters Scraper running on port ${PORT}`));
