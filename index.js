/**
 * HYROX Scraper v3.6 - Fly.io Playwright Edition
 * -------------------------------------------------------
 * ✅ Runs on Playwright base image with Chromium preinstalled
 * ✅ Supports endpoints for health, events, scrape-all, and last-run
 * ✅ Reads events.txt dynamically from GitHub
 */

import express from "express";
import fetch from "node-fetch";
import * as cheerio from "cheerio";
import { chromium } from "playwright";
import fs from "fs";

const app = express();
const PORT = process.env.PORT || 10000;
let lastRun = null;

// URL to your events list (GitHub raw)
const EVENTS_URL = "https://raw.githubusercontent.com/axsion/HyroxScraper/main/events.txt";

// Helper to fetch and normalize events list
async function getEventList() {
  const res = await fetch(EVENTS_URL);
  const text = await res.text();
  const urls = text.split("\n").map(u => u.trim()).filter(u => u.length > 0);
  return urls;
}

// Helper to scrape a single event page
async function scrapeEvent(url, mode = "all") {
  console.log(`🔎 Opening ${url}`);
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();

  try {
    await page.goto(url, { waitUntil: "domcontentloaded", timeout: 90000 });
    const html = await page.content();
    const $ = cheerio.load(html);

    const eventTitle = $("h2").first().text().trim();
    const results = [];

    $(".results").each((_, el) => {
      const category = $(el).find("h3").text().trim();
      const rows = $(el).find("tbody tr");

      rows.each((i, row) => {
        const cols = $(row).find("td").map((_, td) => $(td).text().trim()).get();
        if (cols.length >= 3) {
          results.push({
            event: eventTitle,
            category,
            position: cols[0],
            athlete: cols[1],
            time: cols[2],
          });
        }
      });
    });

    await browser.close();
    return { url, event: eventTitle, count: results.length, results };
  } catch (err) {
    console.error(`❌ Error scraping ${url}: ${err.message}`);
    await browser.close();
    return { url, error: err.message };
  }
}

// ✅ HEALTH endpoint
app.get("/api/health", (_, res) => {
  res.json({ status: "ok", timestamp: new Date().toISOString() });
});

// ✅ CHECK EVENTS
app.get("/api/check-events", async (_, res) => {
  try {
    const urls = await getEventList();
    res.json({ total: urls.length, sample: urls.slice(0, 5) });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ✅ SCRAPE ALL
app.get("/api/scrape-all", async (req, res) => {
  const mode = req.query.mode || "all";
  const urls = await getEventList();

  console.log(`🧠 Starting scrape-all in mode: ${mode}`);
  const start = Date.now();
  const allResults = [];

  for (const url of urls) {
    const result = await scrapeEvent(url, mode);
    if (result.results) allResults.push(...result.results);
  }

  const duration = ((Date.now() - start) / 1000).toFixed(1);
  lastRun = { total: allResults.length, updated: new Date().toISOString() };

  console.log(`🏁 Scrape complete: ${allResults.length} results in ${duration}s`);
  res.json(lastRun);
});

// ✅ LAST RUN
app.get("/api/last-run", (_, res) => {
  if (!lastRun) return res.json({ status: "no runs yet" });
  res.json(lastRun);
});

// ✅ KEEP SERVER ALIVE
app.listen(PORT, () => {
  console.log(`✅ HYROX Scraper running on port ${PORT}`);
});
