/**
 * HYROX Masters Scraper (Fly.io Edition)
 * --------------------------------------
 * ✅ Scrapes only Masters categories (45-49 and up)
 * ✅ Supports MEN + WOMEN
 * ✅ Chromium path works in Fly.io deploy
 * ✅ Saves last-run data to /data/last-run.json
 */

import express from "express";
import fetch from "node-fetch";
import * as cheerio from "cheerio";
import fs from "fs";
import path from "path";
import { chromium } from "playwright-core";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const app = express();
const PORT = process.env.PORT || 8080;

// ====== Local persistent storage ======
const LAST_RUN_FILE = "/data/last-run.json";

// ====== Chromium binary on Fly.io ======
const CHROMIUM_PATH = "/usr/bin/chromium-browser";

// ====== Masters categories ======
const MASTERS = ["45-49", "50-54", "55-59", "60-64", "65-69", "70-74", "75-79"];

// ====== Gender Slugs ======
const GENDERS = [
  { slug: "hyrox-men", label: "MEN" },
  { slug: "hyrox-women", label: "WOMEN" }
];

// ====== Season Event Slugs (dynamic source still supported) ======
const EVENTS_URL =
  "https://raw.githubusercontent.com/axsion/HyroxScraper/main/events.txt";

// Load events.txt from GitHub
async function loadEvents() {
  try {
    const res = await fetch(EVENTS_URL);
    const text = await res.text();
    return text.split("\n").map(e => e.trim()).filter(e => e.length > 0);
  } catch (err) {
    console.error("Failed to load events list:", err);
    return [];
  }
}

// Scrape a single podium page
async function scrapePodium(url, eventSlug, genderLabel, category) {
  const browser = await chromium.launch({
    args: ["--no-sandbox", "--disable-gpu"],
    executablePath: CHROMIUM_PATH,
    headless: true
  });

  const page = await browser.newPage();
  await page.goto(url, { waitUntil: "domcontentloaded" });

  const html = await page.content();
  const $ = cheerio.load(html);

  const rows = [];

  $(".ranking-list tbody tr").each((_, el) => {
    const tds = $(el).find("td");
    if (tds.length < 6) return;

    const place = $(tds[0]).text().trim();
    const athlete = $(tds[1]).text().trim();
    const time = $(tds[5]).text().trim();

    if (["1", "2", "3"].includes(place)) {
      rows.push({ place, athlete, time });
    }
  });

  await browser.close();

  if (rows.length < 3) return []; // nothing useful

  let city = eventSlug.split("-")[2] || "";
  city = city.charAt(0).toUpperCase() + city.slice(1);

  const year = "2025";

  return [[
    `Ranking of ${year} ${city} HYROX ${genderLabel.toUpperCase()}${category}`,
    `Ranking of ${year} ${city} HYROX ${genderLabel.toUpperCase()}`,
    city,
    year,
    category,
    genderLabel.toUpperCase(),
    rows[0].athlete,
    rows[0].time,
    rows[1].athlete,
    rows[1].time,
    rows[2].athlete,
    rows[2].time
  ]];
}

// Scrape a full event (MEN + WOMEN x Masters categories)
async function scrapeEvent(eventSlug) {
  const results = [];

  for (const g of GENDERS) {
    for (const cat of MASTERS) {
      const url = `https://www.hyresult.com/ranking/${eventSlug}/${g.slug}?ag=${cat}`;
      const rows = await scrapePodium(url, eventSlug, g.label, cat);
      if (rows.length) results.push(...rows);
    }
  }

  return results;
}

// Health check
app.get("/api/health", (_, res) => res.json({ status: "ok" }));

// Check which events are accessible
app.get("/api/check-events", async (_, res) => {
  const events = await loadEvents();
  const results = await Promise.all(events.map(async slug => {
    const testUrl = `https://www.hyresult.com/ranking/${slug}`;
    try {
      const r = await fetch(testUrl);
      return { slug, url: testUrl, status: r.status === 200 ? "ok" : "not-found" };
    } catch {
      return { slug, url: testUrl, status: "error" };
    }
  }));
  res.json(results);
});

// Scrape one event
app.get("/api/scrape/:slug", async (req, res) => {
  try {
    const data = await scrapeEvent(req.params.slug);
    res.json({ rows: data });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Scrape all events
app.get("/api/scrape-all", async (_, res) => {
  const events = await loadEvents();
  let allRows = [];
  const resultSummary = [];

  for (const slug of events) {
    const data = await scrapeEvent(slug);
    resultSummary.push({ slug, produced: data.length });
    allRows.push(...data);
  }

  // Save last-run for Google Sheets
  fs.writeFileSync(
    LAST_RUN_FILE,
    JSON.stringify(
      { last_run: new Date().toISOString(), total_rows_output: allRows.length },
      null,
      2
    )
  );

  res.json({
    results: resultSummary,
    total_rows: allRows.length,
    rows: allRows,
    columns: [
      "Event plus Cat","Event","City","Date","Category","Gender",
      "Gold","Time1","Silver","Time2","Bronze","Time3"
    ]
  });
});

// Last run summary
app.get("/api/last-run", (_, res) => {
  if (!fs.existsSync(LAST_RUN_FILE)) {
    return res.json({ last_run: null, total_rows_output: 0 });
  }
  const data = JSON.parse(fs.readFileSync(LAST_RUN_FILE, "utf-8"));
  res.json(data);
});

app.listen(PORT, () => console.log(`✅ HYROX Masters scraper running on :${PORT}`));
