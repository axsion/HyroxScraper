/**
 * HYROX Scraper v3.2 (Render Free Tier Compatible)
 * -----------------------------------------------
 * ✅ Works without --with-deps
 * ✅ Uses @playwright/browser-chromium
 * ✅ Includes deterministic Chromium path fallback
 * ✅ Waits for .ranking-table to hydrate before scraping
 */

import express from "express";
import cheerio from "cheerio";
import { chromium } from "@playwright/browser-chromium";
import path from "path";
import fetch from "node-fetch";

const app = express();
app.use(express.json());
const PORT = process.env.PORT || 10000;

// -----------------------------------------------------------------------------
// 🧠 Utility: Resolve Chromium executable path
// -----------------------------------------------------------------------------
function getChromiumPath() {
  try {
    // Where Playwright stores browser binaries in Render's build image
    const chromiumPath = path.join(
      process.cwd(),
      "node_modules",
      "@playwright",
      "browser-chromium",
      ".local-browsers"
    );

    // Find a subfolder like chromium-1124/chrome-linux/chrome
    // (we’ll dynamically detect it)
    const fs = require("fs");
    const subdirs = fs.readdirSync(chromiumPath);
    for (const dir of subdirs) {
      const maybePath = path.join(
        chromiumPath,
        dir,
        "chrome-linux",
        "chrome"
      );
      if (fs.existsSync(maybePath)) return maybePath;
    }
  } catch (err) {
    console.warn("⚠️ Could not resolve Chromium path automatically:", err.message);
  }
  return null;
}

// -----------------------------------------------------------------------------
// 🩺 Health Check
// -----------------------------------------------------------------------------
app.get("/api/health", (req, res) => {
  res.json({
    status: "ok",
    service: "HYROX Scraper",
    node: process.version,
    time: new Date().toISOString(),
  });
});

// -----------------------------------------------------------------------------
// 🧾 Check Events
// -----------------------------------------------------------------------------
app.get("/api/check-events", async (req, res) => {
  try {
    const events = await fetchEventsList();
    res.json({
      total: events.length,
      sample: events.slice(0, 5),
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// -----------------------------------------------------------------------------
// 🏃‍♂️ Full scrape of all events
// -----------------------------------------------------------------------------
app.get("/api/scrape-all", async (req, res) => {
  try {
    const events = await fetchEventsList();
    console.log(`🌍 Starting full scrape of ${events.length} events...`);

    const chromiumPath = getChromiumPath();
    const browser = await chromium.launch({
      headless: true,
      executablePath: chromiumPath || undefined,
      args: ["--no-sandbox", "--disable-dev-shm-usage"],
    });

    const page = await browser.newPage();
    const results = [];

    for (const url of events) {
      console.log(`🔎 Scraping: ${url}`);
      const podium = await scrapePodium(page, url);
      results.push({ url, podium });
    }

    await browser.close();
    console.log("✅ Scrape complete.");
    res.json({ count: results.length, results });
  } catch (err) {
    console.error("❌ scrape-all error:", err.message);
    res.status(500).json({ error: err.message });
  }
});

// -----------------------------------------------------------------------------
// 🥇 Scrape a single event podium
// -----------------------------------------------------------------------------
async function scrapePodium(page, url) {
  try {
    await page.goto(url, { waitUntil: "networkidle", timeout: 60000 });
    await page.waitForSelector(".ranking-table tbody tr", { timeout: 25000 });

    const html = await page.content();
    const $ = cheerio.load(html);
    const podium = [];

    $(".ranking-table tbody tr")
      .slice(0, 3)
      .each((_, el) => {
        const cells = $(el).find("td");
        const rank = $(cells[0]).text().trim();
        const name = $(cells[1]).text().trim();
        const time = $(cells[cells.length - 1]).text().trim();
        podium.push({ rank, name, time });
      });

    if (podium.length === 0)
      console.warn(`⚠️ No podium for ${url}`);
    else
      console.log(`🏆 ${url} → ${podium[0].name} (${podium[0].time})`);

    return podium;
  } catch (e) {
    console.error(`💥 Failed to scrape ${url}: ${e.message}`);
    return [];
  }
}

// -----------------------------------------------------------------------------
// 📜 Fetch list of event URLs (dynamic source)
// -----------------------------------------------------------------------------
async function fetchEventsList() {
  const res = await fetch(
    "https://raw.githubusercontent.com/axsion/HyroxScraper/main/events.txt"
  );
  if (!res.ok) throw new Error("Failed to load events.txt");
  const text = await res.text();
  return text
    .split("\n")
    .map((l) => l.trim())
    .filter((l) => l && l.startsWith("https"));
}

// -----------------------------------------------------------------------------
// 🚀 Start server
// -----------------------------------------------------------------------------
app.listen(PORT, () => {
  console.log(`✅ HYROX Scraper running on port ${PORT}`);
});
