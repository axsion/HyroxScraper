/**
 * HYROX Masters Podium Scraper
 * Fly.io version — fast HTML parsing, NO browser required.
 */

import express from "express";
import fetch from "node-fetch";
import cheerio from "cheerio";
import fs from "fs";
import path from "path";

const app = express();
const PORT = process.env.PORT || 8080;
const DATA_FILE = "/data/masters.json";

// Masters age groups to scrape
const AGE_GROUPS = ["45-49", "50-54", "55-59", "60-64", "65-69", "70-74"];

/**
 * Load dynamic event list from GitHub (canonical source)
 */
async function loadEvents() {
  const url = "https://raw.githubusercontent.com/axsion/HyroxScraper/main/events.txt";
  const res = await fetch(url);
  const text = await res.text();
  const base = text.split("\n").map(s => s.trim()).filter(Boolean);

  const expanded = [];
  for (const slug of base) {
    expanded.push(`${slug}-hyrox-men`);
    expanded.push(`${slug}-hyrox-women`);
  }
  return expanded;
}

/**
 * Extract city + year from slug
 */
function parseEvent(slug) {
  const parts = slug.split("-");
  const year = parts[1]?.replace("2025", "2025");
  const city = parts[2] ? parts[2].charAt(0).toUpperCase() + parts[2].slice(1) : "";

  const gender = slug.includes("women") ? "WOMEN" : "MEN";
  const eventName = slug.includes("men")
    ? `Ranking of 2025 ${city} HYROX MEN`
    : `Ranking of 2025 ${city} HYROX WOMEN`;

  return { city, year: "2025", eventName, gender };
}

/**
 * Scrape one podium page
 */
async function scrapePodium(url) {
  const res = await fetch(url);
  if (!res.ok) return null;
  const html = await res.text();
  const $ = cheerio.load(html);

  const rows = $(".table-row");
  if (rows.length === 0) return null;

  const podium = rows.slice(0, 3).map((i, el) => {
    const name = $(el).find(".table-col.a > a, .table-col.a").text().trim();
    const time = $(el).find(".table-col.time").text().trim();
    return { name, time };
  }).get();

  if (podium.length < 3) return null;
  return podium;
}

/**
 * Scrape all events × genders × age groups
 */
async function scrapeAllMasters() {
  const results = [];
  const events = await loadEvents();

  for (const slug of events) {
    const { city, year, eventName, gender } = parseEvent(slug);

    for (const age of AGE_GROUPS) {
      const url = `https://www.hyresult.com/ranking/${slug}?ag=${age}`;
      const podium = await scrapePodium(url);

      if (!podium) {
        results.push([
          `No podium available for ${slug}?ag=${age}`,
          slug,
          city,
          year,
          age,
          gender,
          "",
          "",
          "",
          "",
          "",
          ""
        ]);
        continue;
      }

      results.push([
        `${eventName}${age}`,
        eventName,
        city,
        year,
        age,
        gender,
        podium[0].name, podium[0].time,
        podium[1].name, podium[1].time,
        podium[2].name, podium[2].time
      ]);
    }
  }

  return results;
}

/**
 * Save cache
 */
function saveCache(rows) {
  fs.writeFileSync(DATA_FILE, JSON.stringify({
    rows,
    last_run: new Date().toISOString()
  }, null, 2));
}

/**
 * Load cache
 */
function loadCache() {
  if (!fs.existsSync(DATA_FILE)) return null;
  return JSON.parse(fs.readFileSync(DATA_FILE, "utf8"));
}

/**
 * API — Trigger scrape and update cache
 */
app.get("/api/update-masters", async (req, res) => {
  try {
    const rows = await scrapeAllMasters();
    saveCache(rows);
    res.json({ ok: true, updated: rows.length });
  } catch (e) {
    res.json({ error: e.toString() });
  }
});

/**
 * API — Return cached results (Google Sheets reads this)
 */
app.get("/api/masters", (req, res) => {
  const cache = loadCache();
  if (!cache) return res.json({ total_rows: 0, rows: [], columns, last_run: null });

  res.json({
    total_rows: cache.rows.length,
    rows: cache.rows,
    columns,
    last_run: cache.last_run
  });
});

/**
 * Health Check
 */
app.get("/api/health", (req, res) => res.json({ ok: true }));

const columns = [
  "Event plus Cat", "Event", "City", "Date", "Category",
  "Gender", "Gold", "Time1", "Silver", "Time2", "Bronze", "Time3"
];

app.listen(PORT, () => console.log(`✅ HYROX Masters scraper running on ${PORT}`));
