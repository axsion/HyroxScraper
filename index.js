/**
 * HYROX Scraper v3.6 – Fly.io / Render Compatible
 * ------------------------------------------------
 * ✅ Uses Playwright (not -core) with baked-in Chromium
 * ✅ Works on Fly.io & Render with Node 18+
 * ✅ Endpoints:
 *    - /api/health
 *    - /api/check-events
 *    - /api/scrape
 *    - /api/scrape-all
 *    - /api/last-run
 */

import express from "express";
import fetch from "node-fetch";
import * as cheerio from "cheerio";
import { chromium } from "playwright";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PORT = process.env.PORT || 10000;
const app = express();

// 🌍 External events list (dynamic from GitHub)
const EVENTS_URL = "https://raw.githubusercontent.com/axsion/HyroxScraper/main/events.txt";
const LAST_RUN_FILE = path.join(__dirname, "last-run.json");

// 🩺 Health check
app.get("/api/health", (req, res) => {
  res.status(200).json({ status: "ok", message: "HYROX Scraper is alive" });
});

// 🧾 Check events file
app.get("/api/check-events", async (req, res) => {
  try {
    const data = await fetch(EVENTS_URL);
    const text = await data.text();
    const events = text
      .split("\n")
      .map((line) => line.trim())
      .filter((line) => line.startsWith("http"));
    res.json({ total: events.length, sample: events.slice(0, 5) });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// 🕷️ Scrape a single HYROX event page
app.get("/api/scrape", async (req, res) => {
  const { url } = req.query;
  if (!url) return res.status(400).json({ error: "Missing ?url parameter" });

  console.log(`🔎 Opening ${url}`);
  let browser;

  try {
    browser = await chromium.launch({
      headless: true,
      args: ["--no-sandbox", "--disable-setuid-sandbox"],
    });

    const page = await browser.newPage();
    await page.goto(url, { waitUntil: "domcontentloaded", timeout: 60000 });
    const html = await page.content();
    const $ = cheerio.load(html);

    // Example scrape
    const title = $("title").text().trim();
    const categories = [];
    $("table").each((i, el) => {
      const caption = $(el).prev("h2, h3").text().trim();
      if (caption) categories.push(caption);
    });

    await browser.close();

    res.json({ success: true, url, title, categories });
  } catch (error) {
    if (browser) await browser.close();
    res.status(500).json({ error: error.message });
  }
});

// 🧭 Scrape all events dynamically
app.get("/api/scrape-all", async (req, res) => {
  try {
    const response = await fetch(EVENTS_URL);
    const text = await response.text();
    const urls = text
      .split("\n")
      .map((line) => line.trim())
      .filter((line) => line.startsWith("http"));

    const results = [];
    for (const url of urls) {
      console.log(`🌍 Scraping ${url}`);
      try {
        const r = await fetch(
          `${req.protocol}://${req.get("host")}/api/scrape?url=${encodeURIComponent(url)}`
        );
        const data = await r.json();
        results.push(data);
      } catch (e) {
        results.push({ url, error: e.message });
      }
    }

    // Save metadata
    fs.writeFileSync(
      LAST_RUN_FILE,
      JSON.stringify({ date: new Date().toISOString(), total: results.length }, null, 2)
    );

    res.json({ total: results.length, results });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// 🕓 Last run info
app.get("/api/last-run", (req, res) => {
  if (!fs.existsSync(LAST_RUN_FILE)) {
    return res.status(404).json({ error: "No last-run data found" });
  }
  const data = JSON.parse(fs.readFileSync(LAST_RUN_FILE, "utf8"));
  res.json(data);
});

// 🏠 Root route
app.get("/", (req, res) => {
  res.send("✅ HYROX Scraper is running! Try /api/scrape or /api/scrape-all");
});

// 🚀 Start server
app.listen(PORT, "0.0.0.0", () => {
  console.log(`✅ HYROX Scraper running on port ${PORT}`);
});
