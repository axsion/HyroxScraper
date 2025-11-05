/**
 * HYROX Masters Scraper v1.0 (Fly.io optimized)
 * ------------------------------------------------------------
 * ✅ Scrapes only Masters categories (45-49 → 70-74)
 * ✅ One-time scrape → cached into masters_cache.json
 * ✅ /api/masters returns FAST cached data for Google Sheets
 * ✅ /api/update-masters scrapes fresh data when you choose
 */

import express from "express";
import fetch from "node-fetch";
import * as cheerio from "cheerio";
import fs from "fs";
import path from "path";

const app = express();
const PORT = process.env.PORT || 8080;

// Where we save the results
const CACHE_FILE = path.join(process.cwd(), "masters_cache.json");

// Masters categories to scrape
const AGE_GROUPS = ["45-49", "50-54", "55-59", "60-64", "65-69", "70-74"];

// Load events list from GitHub raw file
async function loadEvents() {
  const url = "https://raw.githubusercontent.com/axsion/HyroxScraper/main/events.txt";
  const res = await fetch(url);
  const text = await res.text();
  return text.split("\n").map(s => s.trim()).filter(s => s.length > 3);
}

// Read cache
function readCache() {
  if (!fs.existsSync(CACHE_FILE)) return { lastRun: null, rows: [] };
  try {
    return JSON.parse(fs.readFileSync(CACHE_FILE, "utf8"));
  } catch {
    return { lastRun: null, rows: [] };
  }
}

// Write cache
function writeCache(data) {
  fs.writeFileSync(CACHE_FILE, JSON.stringify(data, null, 2));
}

// Scrape ONE event for all masters groups
async function scrapeEvent(slug) {
  const rows = [];

  for (const ag of AGE_GROUPS) {
    const url = `https://www.hyresult.com/ranking/${slug}?ag=${ag}`;
    const res = await fetch(url);
    const html = await res.text();
    const $ = cheerio.load(html);

    // Event name & city
    const eventTitle = $("h1").first().text().trim();
    const city = eventTitle.split(" ").pop(); // quick heuristic
    const year = eventTitle.match(/20\d{2}/) ? eventTitle.match(/20\d{2}/)[0] : "";

    // Table rows
    const trs = $("table tbody tr").slice(0, 3); // Top 3 only
    trs.each((_, tr) => {
      const tds = $(tr).find("td");
      const name = $(tds.eq(1)).find("a").text().trim();
      const time = tds.eq(4).text().trim();
      const gender = slug.includes("men") ? "MEN" : "WOMEN";

      rows.push([
        `${eventTitle}${ag}`,
        eventTitle,
        city,
        year,
        ag,
        gender,
        name,
        time,
      ]);
    });
  }

  // Convert grouped rows into podium format (Gold/Silver/Bronze)
  const grouped = [];
  for (let i = 0; i < rows.length; i += 3) {
    const g = rows[i];
    const s = rows[i + 1];
    const b = rows[i + 2];
    if (!b) continue;
    grouped.push([
      g[0], g[1], g[2], g[3], g[4], g[5],
      g[6], g[7],
      s[6], s[7],
      b[6], b[7]
    ]);
  }

  return grouped;
}

// ========== ROUTES ==========

// Return cached results (fast)
app.get("/api/masters", (_req, res) => {
  const c = readCache();
  res.json({
    total_rows: c.rows.length,
    rows: c.rows,
    columns: [
      "Event plus Cat","Event","City","Date","Category",
      "Gender","Gold","Time1","Silver","Time2","Bronze","Time3"
    ],
    lastRun: c.lastRun
  });
});

// Scrape fresh data and update cache
app.get("/api/update-masters", async (_req, res) => {
  try {
    console.log("⏳ Scraping Masters...");
    const slugs = await loadEvents();
    let allRows = [];

    for (const slug of slugs) {
      console.log("→", slug);
      const results = await scrapeEvent(slug);
      allRows = allRows.concat(results);
    }

    writeCache({ lastRun: new Date().toISOString(), rows: allRows });

    res.json({ ok: true, updated: allRows.length });
  } catch (err) {
    res.status(500).json({ error: String(err) });
  }
});

app.get("/", (_req, res) => res.send("HYROX Masters Scraper is running ✅"));

app.listen(PORT, () => console.log(`✅ Server on :${PORT}`));
