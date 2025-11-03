/**
 * HYROX Scraper v3.6 - Fly.io edition
 * -----------------------------------
 * ✅ Uses Playwright base image with Chromium preinstalled
 * ✅ Crawls all events listed in events.txt on GitHub
 * ✅ Outputs aggregated results for SOLO and DOUBLES
 * ✅ Includes endpoints:
 *    - /api/health
 *    - /api/check-events
 *    - /api/scrape-all
 *    - /api/scrape-all?mode=solo
 *    - /api/scrape-all?mode=double
 *    - /api/last-run
 */

import express from "express";
import fetch from "node-fetch";
import { chromium } from "playwright";
import * as cheerio from "cheerio";

const app = express();
const PORT = process.env.PORT || 10000;
const EVENTS_URL =
  "https://raw.githubusercontent.com/axsion/HyroxScraper/main/events.txt";

let lastRun = {
  total: 0,
  updated: null,
  events: [],
};

// 🧠 Utility: safe delay
const sleep = (ms) => new Promise((res) => setTimeout(res, ms));

/**
 * 🔹 Health endpoint
 */
app.get("/api/health", (req, res) => {
  res.json({ status: "ok", time: new Date().toISOString() });
});

/**
 * 🔹 Return list of events from GitHub
 */
app.get("/api/check-events", async (req, res) => {
  try {
    const response = await fetch(EVENTS_URL);
    const text = await response.text();
    const lines = text
      .split("\n")
      .map((l) => l.trim())
      .filter((l) => l.startsWith("http"));
    res.json({ total: lines.length, sample: lines.slice(0, 5) });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/**
 * 🔹 Full scraping route
 */
app.get("/api/scrape-all", async (req, res) => {
  const mode = req.query.mode || "all"; // solo | double | all
  console.log(`🚀 Starting scrape-all (mode=${mode})`);

  try {
    // Step 1. Fetch event URLs
    const response = await fetch(EVENTS_URL);
    const text = await response.text();
    const eventUrls = text
      .split("\n")
      .map((l) => l.trim())
      .filter((l) => l.startsWith("http"));

    console.log(`🧠 Found ${eventUrls.length} events to scrape.`);

    // Step 2. Launch browser
    const browser = await chromium.launch({
      headless: true,
      args: ["--no-sandbox", "--disable-setuid-sandbox"],
    });
    const context = await browser.newContext();
    const page = await context.newPage();

    const results = [];

    // Step 3. Loop through each event
    for (const url of eventUrls) {
      console.log(`🔍 Scraping ${url}`);

      try {
        await page.goto(url, { waitUntil: "domcontentloaded", timeout: 60000 });
        const html = await page.content();
        const $ = cheerio.load(html);

        // Basic parsing logic
        const eventName =
          $("h1").first().text().trim() ||
          $("title").text().trim() ||
          "Unknown Event";
        const cityMatch = eventName.match(/2025\s(.+)/);
        const city = cityMatch ? cityMatch[1].trim() : eventName;
        const date = $("div.date").text().trim() || "2025";

        const tables = $("table"); // podium tables
        if (tables.length === 0) {
          console.log(`⚠️ No tables found for ${eventName}`);
          continue;
        }

        tables.each((_, table) => {
          const divTitle =
            $(table).prev("h2").text().trim() ||
            $(table).prev("h3").text().trim() ||
            "";

          const division =
            divTitle.toUpperCase().includes("DOUBLES") ? "Doubles" : "Solo";

          // Skip if mode filter is active
          if (mode === "solo" && division === "Doubles") return;
          if (mode === "double" && division === "Solo") return;

          const ageGroup = divTitle.match(/\d{2}-\d{2}/)
            ? divTitle.match(/\d{2}-\d{2}/)[0]
            : "";
          const gender = /WOMEN|FEMALE|FEMMES|FÉMININ/i.test(divTitle)
            ? "Women"
            : /MEN|MALE|HOMMES|MASCULIN/i.test(divTitle)
            ? "Men"
            : "";

          const podium = [];
          $(table)
            .find("tr")
            .slice(1, 4)
            .each((i, tr) => {
              const tds = $(tr).find("td");
              const athlete = $(tds[1]).text().trim();
              const time = $(tds[2]).text().trim();
              if (athlete && time) {
                podium.push({
                  place: i + 1,
                  athlete,
                  time,
                });
              }
            });

          if (podium.length > 0) {
            results.push({
              event: eventName,
              city,
              date,
              division,
              age_group: ageGroup,
              gender,
              podium,
              url,
            });
            console.log(
              `✅ Parsed ${podium.length} podiums from ${eventName} (${division})`
            );
          }
        });

        await sleep(500); // be polite
      } catch (err) {
        console.log(`❌ Error scraping ${url}:`, err.message);
      }
    }

    await browser.close();

    // Step 4. Update metadata
    lastRun = {
      total: results.length,
      updated: new Date().toISOString(),
      events: results.map((r) => r.event),
    };

    console.log(
      `🏁 Scraping completed: ${results.length} podium groups extracted.`
    );

    res.json({
      total: results.length,
      updated: lastRun.updated,
      sample: results.slice(0, 3),
      mode,
    });
  } catch (err) {
    console.error("❌ scrape-all error:", err);
    res.status(500).json({ error: err.message });
  }
});

/**
 * 🔹 Last run info
 */
app.get("/api/last-run", (req, res) => {
  res.json(lastRun);
});

/**
 * 🔹 Root endpoint (summary)
 */
app.get("/", (req, res) => {
  res.send(`
    <h2>HYROX Scraper v3.6 (Fly.io)</h2>
    <ul>
      <li>/api/health</li>
      <li>/api/check-events</li>
      <li>/api/scrape-all</li>
      <li>/api/scrape-all?mode=solo</li>
      <li>/api/scrape-all?mode=double</li>
      <li>/api/last-run</li>
    </ul>
  `);
});

app.listen(PORT, () => {
  console.log(`✅ HYROX Scraper running on port ${PORT}`);
});
