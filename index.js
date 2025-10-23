/**
 * HYROX Scraper v14 — Persistent + Two-Step flow for Google Sheets
 * Frederic Bergeron | October 2025
 *
 * ✅ Persists last results to /data/last-run.json
 * ✅ Adds /api/scrape-batch-save for long scraping jobs
 * ✅ Adds /api/last-run for instant read (Google Sheets)
 * ✅ Timeout-safe & Render free-tier friendly
 */

import express from "express";
import fs from "fs";
import path from "path";
import { chromium } from "playwright";

const app = express();
const PORT = process.env.PORT || 10000;

const DATA_DIR = path.resolve("./data");
const LAST_RUN_FILE = path.join(DATA_DIR, "last-run.json");

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

// 🟢 Step 1: Long scrape that saves results to disk
app.get("/api/scrape-batch-save", async (req, res) => {
  const offset = parseInt(req.query.offset || "0", 10);
  const limit = parseInt(req.query.limit || "10", 10);
  const subset = EVENT_BASE_URLS.slice(offset, offset + limit);
  console.log(`🚀 Starting SAVE batch from index ${offset}`);

  res.json({
    message: `🟡 Batch started (offset=${offset}, limit=${limit}) — results will be saved to /data/last-run.json`
  });

  try {
    const browser = await chromium.launch({
      headless: true,
      args: ["--no-sandbox", "--disable-gpu", "--disable-dev-shm-usage"]
    });

    const page = await browser.newPage();
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

    const output = {
      scrapedAt: new Date().toISOString(),
      count: results.length,
      nextOffset: offset + limit < EVENT_BASE_URLS.length ? offset + limit : null,
      events: results
    };

    if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
    fs.writeFileSync(LAST_RUN_FILE, JSON.stringify(output, null, 2));
    console.log(`✅ Saved ${results.length} events to last-run.json`);
  } catch (err) {
    console.error("❌ Error saving batch:", err);
  }
});

// 🟢 Step 2: Fast endpoint for Google Sheets to read saved data
app.get("/api/last-run", (req, res) => {
  if (!fs.existsSync(LAST_RUN_FILE)) {
    return res.status(404).json({ error: "No last-run data found" });
  }
  const data = JSON.parse(fs.readFileSync(LAST_RUN_FILE, "utf8"));
  res.json(data);
});

// 🧪 For manual single-event testing
app.get("/api/scrape", async (req, res) => {
  const url = req.query.url;
  if (!url) return res.status(400).json({ error: "Missing ?url=" });

  const browser = await chromium.launch({
    headless: true,
    args: ["--no-sandbox", "--disable-gpu", "--disable-dev-shm-usage"]
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
    const fullUrl = baseUrl.includes("?ag=") ? baseUrl : `${baseUrl}?ag=${ag}`;
    console.log(`🔎 Scraping ${fullUrl}`);
    const data = await scrapeCategory(page, fullUrl, ag);
    if (data) results.push(data);
  }
  return results;
}

async function scrapeCategory(page, url, ageGroup) {
  try {
    console.log(`🔎 Visiting ${url}`);

    // 🕐 Attempt 1: standard navigation (max 25s)
    try {
      await page.goto(url, { waitUntil: "networkidle", timeout: 25000 });
    } catch {
      console.log(`⚠️ Slow load for ${url}, retrying...`);
      try {
        await page.goto(url, { waitUntil: "domcontentloaded", timeout: 25000 });
      } catch {
        console.log(`⏩ Skipped (slow/no response): ${url}`);
        return null;
      }
    }

    const tableExists = await page.$("table tr td:nth-child(4)");
    if (!tableExists) {
      console.log(`⚠️ No results table for ${url} — skipping.`);
      return null;
    }

    const eventName = await page.title();
    const podium = await page.$$eval(
      "table tr",
      (rows, ageGroup) =>
        Array.from(rows)
          .slice(0, 3)
          .map((r) => {
            const tds = Array.from(r.querySelectorAll("td"));
            const rank = tds[1]?.innerText.trim();
            const name = tds[3]?.innerText.trim();
            const detectedAge = tds[4]?.innerText.trim();
            const time = tds[5]?.innerText.trim();
            return { rank, name, ageGroup: detectedAge || ageGroup, time };
          })
          .filter((r) => r.name && r.time),
      ageGroup
    );

    if (!podium.length) {
      console.log(`⚠️ Empty table for ${url}`);
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
  console.log(`✅ HYROX Scraper v14 running on port ${PORT}`)
);
