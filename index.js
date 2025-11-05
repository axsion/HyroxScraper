/**
 * HYROX Masters Scraper (45+ only)
 * Works with Fly.io + Google Sheets integration
 */

import express from "express";
import fetch from "node-fetch";
import * as cheerio from "cheerio";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const app = express();
const PORT = process.env.PORT || 8080;

// --------------------------------------------
// ✅ CORS + Google Sheets user-agent fix
// --------------------------------------------
app.use((req, res, next) => {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, User-Agent");
  res.setHeader("Access-Control-Allow-Methods", "GET, OPTIONS");
  if (req.method === "OPTIONS") return res.sendStatus(200);
  if (!req.headers["user-agent"]) {
    req.headers["user-agent"] = "Google-Apps-Script";
  }
  next();
});

// --------------------------------------------
// ✅ Load event list dynamically from GitHub
// (already your canonical reference)
// --------------------------------------------
const EVENTS_URL = "https://raw.githubusercontent.com/axsion/HyroxScraper/main/events.txt";

async function loadEvents() {
  const txt = await fetch(EVENTS_URL).then(r => r.text());
  return txt
    .split("\n")
    .map(l => l.trim())
    .filter(l => l.length > 0)
    .map(slug => ({
      slug,
      men: `https://www.hyresult.com/ranking/${slug}-hyrox-men`,
      women: `https://www.hyresult.com/ranking/${slug}-hyrox-women`
    }));
}

// --------------------------------------------
// ✅ Masters categories only
// --------------------------------------------
const MASTERS = ["45-49", "50-54", "55-59", "60-64", "65-69", "70-74", "75-79"];

// --------------------------------------------
// ✅ Scrape single leaderboard page with category parameter
// --------------------------------------------
async function scrapeCategory(baseUrl, category) {
  const url = `${baseUrl}?ag=${category}`;
  const html = await fetch(url).then(r => r.text());
  const $ = cheerio.load(html);

  const title = $("h1").first().text().trim();
  if (!title || title.length < 5) return [];

  const rows = [];
  $("table tbody tr").each((_, tr) => {
    const tds = $(tr).find("td");
    if (tds.length < 6) return;

    rows.push([
      `${title}${category}`,
      title.replace(category, "").trim(),
      $("span.city").text().trim() || "",
      $("span.season").text().replace(/[^\d]/g, "") || "",
      category,
      title.toUpperCase().includes("WOMEN") ? "WOMEN" : "MEN",
      $(tds[1]).text().trim(),
      $(tds[2]).text().trim(),
      $(tds[3]).text().trim(),
      $(tds[4]).text().trim(),
      $(tds[5]).text().trim()
    ]);
  });

  return rows;
}

// --------------------------------------------
// ✅ Full scrape for one event (Men + Women)
// --------------------------------------------
async function scrapeEvent(event) {
  let all = [];
  for (const url of [event.men, event.women]) {
    for (const cat of MASTERS) {
      try {
        const rows = await scrapeCategory(url, cat);
        if (rows.length > 0) all.push(...rows);
      } catch {}
    }
  }
  return all;
}

// --------------------------------------------
// ✅ API endpoint used by Google Sheets
// --------------------------------------------
app.get("/api/masters", async (req, res) => {
  try {
    const events = await loadEvents();
    let results = [];

    for (const e of events) {
      const rows = await scrapeEvent(e);
      results.push({
        slug: e.slug,
        produced: rows.length
      });
      results = results.concat(rows);
    }

    const onlyRows = results.filter(r => Array.isArray(r));

    res.json({
      total_rows: onlyRows.length,
      rows: onlyRows,
      columns: [
        "Event plus Cat","Event","City","Date","Category","Gender",
        "Gold","Time1","Silver","Time2","Bronze","Time3"
      ]
    });
  } catch (err) {
    res.json({ error: err.message });
  }
});

// --------------------------------------------
app.get("/api/health", (req, res) => res.json({ status: "ok" }));
// --------------------------------------------

app.listen(PORT, () => console.log(`HYROX Masters API running on :${PORT}`));
