/**
 * HYROX Scraper v10 — Stable, Memory-Safe, Correct Selectors
 * Frederic Bergeron | October 2025
 *
 * ✅ Stateless: no file system writes
 * ✅ Works on Render free tier
 * ✅ Extracts podiums for all Masters age groups (45-79)
 * ✅ Tested selector verified on hyresult.com
 * ✅ Ready for Google Sheets integration
 */

import express from "express";
import { chromium } from "playwright";

const app = express();
const PORT = process.env.PORT || 10000;

/* -------------------------------------------------------------------------- */
/*                               EVENT URL LIST                               */
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

const AGE_GROUPS = ["45-49", "50-54", "55-59", "60-64", "65-69", "70-74", "75-79"];

/* -------------------------------------------------------------------------- */
/*                                  ROUTES                                    */
/* -------------------------------------------------------------------------- */

app.get("/api/health", (_, res) => res.json({ ok: true }));

/**
 * /api/scrape-batch?offset=0
 * Runs 10 base events sequentially with one browser instance
 */
app.get("/api/scrape-batch", async (req, res) => {
  const offset = parseInt(req.query.offset || "0");
  const limit = 10;
  const subset = EVENT_BASE_URLS.slice(offset, offset + limit);

  console.log(`🚀 Starting batch from index ${offset}`);

  const browser = await chromium.launch({
    headless: true,
    args: [
      "--no-sandbox",
      "--disable-gpu",
      "--disable-dev-shm-usage",
      "--disable-blink-features=AutomationControlled"
    ]
  });
  const page = await browser.newPage();

  // Pretend to be a normal browser
  await page.setExtraHTTPHeaders({
    "User-Agent":
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0 Safari/537.36"
  });

  const results = [];
  for (const baseUrl of subset) {
    const eventData = await scrapeEvent(page, baseUrl);
    results.push(...eventData);
  }

  await browser.close();

  res.json({
    scrapedAt: new Date().toISOString(),
    count: results.length,
    nextOffset: offset + limit < EVENT_BASE_URLS.length ? offset + limit : null,
    events: results
  });
});

/**
 * /api/scrape?url=<single_event_url>
 */
app.get("/api/scrape", async (req, res) => {
  const url = req.query.url;
  if (!url) return res.status(400).json({ error: "Missing ?url=" });

  const browser = await chromium.launch({
    headless: true,
    args: [
      "--no-sandbox",
      "--disable-gpu",
      "--disable-dev-shm-usage",
      "--disable-blink-features=AutomationControlled"
    ]
  });
  const page = await browser.newPage();
  await page.setExtraHTTPHeaders({
    "User-Agent":
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0 Safari/537.36"
  });

  const results = await scrapeEvent(page, url);
  await browser.close();

  res.json({ count: results.length, events: results });
});

/* -------------------------------------------------------------------------- */
/*                              SCRAPER LOGIC                                 */
/* -------------------------------------------------------------------------- */

async function scrapeEvent(page, baseUrl) {
  const results = [];
  for (const ag of AGE_GROUPS) {
    const fullUrl = `${baseUrl}?ag=${ag}`;
    console.log(`🔎 Scraping ${fullUrl}`);
    const data = await scrapeCategory(page, fullUrl, ag);
    if (data) results.push(data);
  }
  return results;
}

async function scrapeCategory(page, url, ageGroup) {
  try {
    console.log(`🔎 Visiting ${url}`);
    await page.goto(url, { waitUntil: "networkidle", timeout: 90000 });
    await page.waitForSelector("table tr td:nth-child(4)", { timeout: 20000 });

    const eventName = await page.title();

    const podium = await page.$$eval("table tr", rows =>
      Array.from(rows)
        .slice(0, 3)
        .map(r => {
          const tds = Array.from(r.querySelectorAll("td"));
          const rank = tds[1]?.innerText.trim();
          const name = tds[3]?.innerText.trim();
          const detectedAge = tds[4]?.innerText.trim();
          const time = tds[5]?.innerText.trim();
          return { rank, name, ageGroup: detectedAge || ageGroup, time };
        })
        .filter(r => r.name && r.time)
    );

    if (!podium.length) {
      console.log(`⚠️ No podium data found for ${url}`);
      return null;
    }

    const gender = /WOMEN/i.test(eventName) ? "Women" : "Men";
    console.log(`✅ ${eventName} (${ageGroup}) → ${podium.length} rows`);
    return { eventName, gender, category: ageGroup, url, podium };
  } catch (err) {
    console.log(`❌ Error scraping ${url}: ${err.message}`);
    return null;
  }
}

/* -------------------------------------------------------------------------- */
/*                               SERVER START                                 */
/* -------------------------------------------------------------------------- */

app.listen(PORT, () =>
  console.log(`✅ HYROX Scraper v10 running on port ${PORT}`)
);
