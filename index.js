/**
 * HYROX Full Season Scraper — Solo Master Categories Only
 * v1.0  (October 2025)
 */

import express from "express";
import fs from "fs";
import path from "path";
import { chromium } from "playwright";

const app = express();
const PORT = process.env.PORT || 10000;
const DATA_FILE = path.resolve("./data/last-run.json");
const HYRESULT_URL = "https://www.hyrox.com/results"; // landing page that lists all events

app.use(express.json());

/**
 * Simple health check
 */
app.get("/api/health", (_, res) => res.json({ ok: true }));

/**
 * Return last cached results
 */
app.get("/api/last-run", (_, res) => {
  if (fs.existsSync(DATA_FILE)) {
    const data = JSON.parse(fs.readFileSync(DATA_FILE, "utf8"));
    return res.json(data);
  }
  return res.json({ events: [] });
});

/**
 * Trigger full scrape (solo master categories only)
 */
app.get("/api/scrape-all", async (req, res) => {
  try {
    const browser = await chromium.launch({ headless: true });
    const page = await browser.newPage();
    await page.goto(HYRESULT_URL, { waitUntil: "domcontentloaded" });

    // Collect all event links on the page
    const eventLinks = await page.$$eval("a[href*='ranking']", els =>
      els.map(e => e.href)
    );

    const events = [];

    for (const link of eventLinks) {
      // Limit optional (use ?limit=N)
      if (req.query.limit && events.length >= Number(req.query.limit)) break;

      // We only want SOLO master events
      if (!/HYROX\s+(MEN|WOMEN)/i.test(link)) continue;
      if (!/(45-49|50-54|55-59|60-64|65-69)/.test(link)) continue;
      if (/DOUBLES/i.test(link) || /RELAY/i.test(link)) continue;

      const eventData = await scrapeEvent(link, page);
      if (eventData) events.push(eventData);
    }

    await browser.close();

    const result = { scrapedAt: new Date().toISOString(), events };

    // Save locally (ephemeral on Render but useful for caching)
    fs.mkdirSync(path.dirname(DATA_FILE), { recursive: true });
    fs.writeFileSync(DATA_FILE, JSON.stringify(result, null, 2));

    res.json(result);
  } catch (err) {
    console.error("Scrape failed:", err);
    res.status(500).json({ error: "Scrape failed", detail: String(err) });
  }
});

/**
 * Scrape a single event podium
 */
async function scrapeEvent(url, page) {
  try {
    await page.goto(url, { waitUntil: "domcontentloaded" });
    const eventName = await page.title();

    const podium = await page.$$eval("table tbody tr", rows => {
      return Array.from(rows)
        .slice(0, 3)
        .map(r => {
          const tds = r.querySelectorAll("td");
          return {
            rank: tds[0]?.innerText.trim(),
            name: tds[1]?.innerText.trim(),
            ageGroup: tds[2]?.innerText.trim(),
            time: tds[tds.length - 1]?.innerText.trim(),
          };
        });
    });

    const gender = /MEN/i.test(eventName) ? "Men" : /WOMEN/i.test(eventName) ? "Women" : "";

    return { eventName, gender, url, podium };
  } catch (e) {
    console.log(`❌ Error scraping ${url}:`, e.message);
    return null;
  }
}

app.listen(PORT, () => console.log(`✅ HYROX Scraper running on port ${PORT}`));
