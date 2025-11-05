/**
 * HYROX Masters Scraper (TEST MODE: Rome Only, Option B enabled)
 * --------------------------------------------------------------
 * ✅ Scrapes only Masters categories (45-49 and older)
 * ✅ Handles HYROX removing old events – returns "No podium available"
 * ✅ Stores results in memory
 * ✅ Google Sheets fetches from /api/masters
 */

import express from "express";
import fetch from "node-fetch";
import * as cheerio from "cheerio";

const app = express();
const PORT = process.env.PORT || 8080;

// Memory cache
let MASTERS_CACHE = [];
let LAST_RUN = null;

// TEST MODE — Rome only
async function loadEvents() {
  return [
    "s8-2025-rome-hyrox-men",
    "s8-2025-rome-hyrox-women"
  ];
}

// Masters age groups allowed
const MASTERS_AGES = ["45-49","50-54","55-59","60-64","65-69","70-74"];

async function safeFetch(url) {
  try {
    const res = await fetch(url);
    if (!res.ok) return null;
    const html = await res.text();
    if (!html || html.length < 1000) return null; // Broken or empty
    return html;
  } catch {
    return null;
  }
}

function parseMasters(html, eventSlug) {
  const $ = cheerio.load(html);
  const rows = [];

  $("div.category-row").each((_, section) => {
    const header = $(section).find("h2, h3").text().trim();
    const match = header.match(/(MEN|WOMEN)(\d{2}-\d{2})/i);
    if (!match) return;

    const gender = match[1].toUpperCase();
    const ageGroup = match[2];

    if (!MASTERS_AGES.includes(ageGroup)) return;

    const athleteRows = $(section).find("tbody tr");
    if (athleteRows.length < 3) return;

    const podium = [];
    athleteRows.each((i, r) => {
      podium.push({
        name: $(r).find("a").text().trim(),
        time: $(r).find("td").eq(2).text().trim()
      });
      if (podium.length >= 3) return false;
    });

    if (podium.length === 3) {
      rows.push([
        `Ranking of ${eventSlug} ${gender}${ageGroup}`,
        `Ranking of ${eventSlug}`,
        eventSlug.split("-")[2], // City approx
        "2025",
        ageGroup,
        gender,
        podium[0].name, podium[0].time,
        podium[1].name, podium[1].time,
        podium[2].name, podium[2].time
      ]);
    }
  });

  return rows;
}

app.get("/api/update-masters", async (req, res) => {
  const events = await loadEvents();
  const allRows = [];

  for (const eventSlug of events) {
    const url = `https://www.hyresult.com/ranking/${eventSlug}`;
    const html = await safeFetch(url);

    if (!html) {
      allRows.push([
        `No podium available for ${eventSlug}`,
        eventSlug, "", "", "", "", "", "", "", "", "", ""
      ]);
      continue;
    }

    const rows = parseMasters(html, eventSlug);
    if (rows.length === 0) {
      allRows.push([
        `No podium available for ${eventSlug}`,
        eventSlug, "", "", "", "", "", "", "", "", "", ""
      ]);
    } else {
      allRows.push(...rows);
    }
  }

  MASTERS_CACHE = allRows;
  LAST_RUN = new Date().toISOString();
  res.json({ ok: true, updated: allRows.length });
});

app.get("/api/masters", (req, res) => {
  res.json({
    total_rows: MASTERS_CACHE.length,
    rows: MASTERS_CACHE,
    columns: [
      "Event plus Cat", "Event", "City", "Date", "Category", "Gender",
      "Gold", "Time1", "Silver", "Time2", "Bronze", "Time3"
    ],
    last_run: LAST_RUN
  });
});

app.get("/", (req, res) => res.send("HYROX Masters Scraper TEST MODE Running ✅"));

app.listen(PORT, () => console.log(`Running on ${PORT}`));
