/**
 * HYROX Scraper v3.6 — Fly.io Edition
 * ------------------------------------
 * ✅ Uses Playwright Chromium (from Playwright base image)
 * ✅ Dynamic events list from GitHub raw file
 * ✅ Express server with health checks and scrape endpoints
 */

import express from "express";
import fetch from "node-fetch";
import * as cheerio from "cheerio";
import { chromium } from "playwright";
import fs from "fs";
import path from "path";

const app = express();
const PORT = process.env.PORT || 10000;

// ✅ Health check
app.get("/api/health", (req, res) => {
  res.json({ status: "ok", time: new Date().toISOString() });
});

// ✅ Check list of events (from GitHub)
app.get("/api/check-events", async (req, res) => {
  try {
    const response = await fetch(
      "https://raw.githubusercontent.com/axsion/HyroxScraper/main/events.txt"
    );
    const text = await response.text();
    const urls = text.split("\n").filter((l) => l.startsWith("http"));
    res.json({ total: urls.length, sample: urls.slice(0, 5) });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ✅ Scrape all events (solo or double)
app.get("/api/scrape-all", async (req, res) => {
  const mode = req.query.mode || "all";
  const results = [];
  const start = Date.now();

  try {
    const response = await fetch(
      "https://raw.githubusercontent.com/axsion/HyroxScraper/main/events.txt"
    );
    const text = await response.text();
    const urls = text.split("\n").filter((l) => l.startsWith("http"));

    const browser = await chromium.launch({ headless: true });
    const context = await browser.newContext();

    for (const url of urls) {
      console.log(`🔎 Opening ${url}`);
      try {
        const page = await context.newPage();
        await page.goto(url, { timeout: 60000 });
        const html = await page.content();
        const $ = cheerio.load(html);

        const title = $("h1, .title, .event-title").first().text().trim();
        const podiums = [];

        $("table tr").each((_, el) => {
          const tds = $(el).find("td");
          if (tds.length >= 3) {
            podiums.push({
              rank: $(tds[0]).text().trim(),
              name: $(tds[1]).text().trim(),
              time: $(tds[2]).text().trim(),
            });
          }
        });

        results.push({ event: title || url, podiums });
        await page.close();
      } catch (e) {
        console.error(`❌ Error scraping ${url}: ${e.message}`);
      }
    }

    await browser.close();
    const elapsed = ((Date.now() - start) / 1000).toFixed(1);

    console.log(`✅ Full scrape complete: ${results.length} events in ${elapsed}s`);
    res.json({ total: results.length, updated: new Date().toISOString() });
  } catch (err) {
    console.error("❌ scrape-all failed:", err);
    res.status(500).json({ error: err.message });
  }
});

// ✅ Root info page
app.get("/", (req, res) => {
  res.send(`
    <h2>HYROX Scraper v3.6 (Fly.io)</h2>
    <p>Endpoints:</p>
    <ul>
      <li><a href="/api/health">/api/health</a></li>
      <li><a href="/api/check-events">/api/check-events</a></li>
      <li><a href="/api/scrape-all">/api/scrape-all</a></li>
    </ul>
  `);
});

// ✅ Start the server and keep container alive
app.listen(PORT, "0.0.0.0", () => {
  console.log(`✅ HYROX Scraper running on port ${PORT}`);
});
