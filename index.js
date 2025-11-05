/**
 * HYROX Masters Scraper (Rome test; per-age URL crawl; placeholders)
 * ---------------------------------------------------------------
 * - Scrapes Masters categories (45-49 → 70-74)
 * - For each slug-gender and age group, request:
 *     https://www.hyresult.com/ranking/<slug-hyrox-men|women>?ag=<age>
 * - If page missing/empty/underfilled -> add "No podium available" placeholder row
 * - In-memory cache, returned quickly via /api/masters
 */

import express from "express";
import fetch from "node-fetch";
import * as cheerio from "cheerio";

const app = express();
const PORT = process.env.PORT || 8080;

// ====== CONFIG ======
const AGE_GROUPS = ["45-49","50-54","55-59","60-64","65-69","70-74"];

// TEST MODE: only Rome (men + women). After validation, swap to dynamic events list.
async function loadEvents() {
  // Example slugs produced normally from your events.txt expansion:
  //   s8-2025-rome-hyrox-men
  //   s8-2025-rome-hyrox-women
  return ["s8-2025-rome-hyrox-men", "s8-2025-rome-hyrox-women"];
}

// ====== CACHE ======
let CACHE_ROWS = [];
let CACHE_LAST_RUN = null;

// ====== HELPERS ======
function titleCase(s) {
  return s
    .split(/[-\s]+/)
    .map(w => w ? w[0].toUpperCase() + w.slice(1).toLowerCase() : w)
    .join(" ")
    .trim();
}

function parseCityYearGenderFromSlug(slug) {
  // slug example: s8-2025-rome-hyrox-men  OR  s7-2025-new-york-hyrox-women
  const parts = slug.split("-");
  // parts: ["s8", "2025", "<city possibly many parts>", "...", "hyrox", "men|women"]
  const year = parts[1] || "";
  // city is everything from index 2 until the "hyrox"
  const hyroxIdx = parts.findIndex(p => p.toLowerCase() === "hyrox");
  const cityParts = parts.slice(2, hyroxIdx);
  const city = titleCase(cityParts.join(" "));
  const gender = (parts[hyroxIdx + 1] || "").toUpperCase(); // MEN or WOMEN
  return { city, year, gender };
}

function buildEventTitle(city, year, gender) {
  // Desired format: "Ranking of 2025 Rome HYROX MEN"
  return `Ranking of ${year} ${city} HYROX ${gender}`;
}

function pickTimeFromRow($, tr) {
  // Try to find the first TD that looks like a time (e.g., 1:05:25 or 59:11)
  let timeText = "";
  $(tr).find("td").each((_, td) => {
    const t = $(td).text().trim();
    if (/^\d{1,2}:\d{2}(:\d{2})?$/.test(t)) { // accept M:SS or H:MM:SS
      timeText = t;
      return false;
    }
  });
  return timeText;
}

function pickAthleteName($, tr) {
  // Prefer an <a> inside the row
  const a = $(tr).find("a").first().text().trim();
  if (a) return a;
  // fallback to second cell (usually name column)
  const alt = $(tr).find("td").eq(1).text().trim();
  return alt || "";
}

async function safeGetHtml(url) {
  try {
    const res = await fetch(url, { redirect: "follow" });
    if (!res.ok) return null;
    const html = await res.text();
    // If site streams/react-chunks, ensure we got enough to include a table
    if (!html || html.length < 800) return null;
    return html;
  } catch {
    return null;
  }
}

// Scrape exactly one (slug-gender, ageGroup) page
async function scrapeOneAge(slugGender, ageGroup) {
  const url = `https://www.hyresult.com/ranking/${slugGender}?ag=${ageGroup}`;
  const html = await safeGetHtml(url);
  if (!html) {
    return {
      ok: false,
      placeholder: [
        `No podium available for ${slugGender}?ag=${ageGroup}`,
        `${slugGender}?ag=${ageGroup}`, "", "", "", "", "", "", "", "", "", ""
      ]
    };
  }

  const { city, year, gender } = parseCityYearGenderFromSlug(slugGender);
  const eventTitle = buildEventTitle(city, year, gender);

  const $ = cheerio.load(html);
  // Find a <table> with a tbody of athletes; be tolerant:
  const rows = $("table tbody tr");
  if (rows.length < 3) {
    return {
      ok: false,
      placeholder: [
        `No podium available for ${slugGender}?ag=${ageGroup}`,
        `${slugGender}?ag=${ageGroup}`, "", "", "", "", "", "", "", "", "", ""
      ]
    };
  }

  // Collect TOP-3
  const podium = [];
  rows.slice(0, 3).each((_, tr) => {
    podium.push({
      name: pickAthleteName($, tr),
      time: pickTimeFromRow($, tr)
    });
  });

  if (podium.length < 3 || podium.some(p => !p.name || !p.time)) {
    return {
      ok: false,
      placeholder: [
        `No podium available for ${slugGender}?ag=${ageGroup}`,
        `${slugGender}?ag=${ageGroup}`, "", "", "", "", "", "", "", "", "", ""
      ]
    };
  }

  // Build a single row in the target format (Gold/Silver/Bronze)
  const sheetRow = [
    `${eventTitle}${ageGroup}`, // "Ranking of 2025 Rome HYROX MEN45-49"
    eventTitle,                 // "Ranking of 2025 Rome HYROX MEN"
    city,
    year,
    ageGroup,
    gender,
    podium[0].name, podium[0].time,
    podium[1].name, podium[1].time,
    podium[2].name, podium[2].time
  ];

  return { ok: true, row: sheetRow };
}

// Scrape one slug (men or women) across all masters ages
async function scrapeSlug(slugGender) {
  const out = [];
  for (const ag of AGE_GROUPS) {
    const r = await scrapeOneAge(slugGender, ag);
    if (r.ok) out.push(r.row);
    else out.push(r.placeholder);
  }
  return out;
}

// ====== ROUTES ======

// Trigger a scrape + cache (Rome test only)
app.get("/api/update-masters", async (_req, res) => {
  try {
    const slugs = await loadEvents(); // Rome men + women (test)
    const all = [];
    for (const slug of slugs) {
      const rows = await scrapeSlug(slug);
      all.push(...rows);
    }
    CACHE_ROWS = all;
    CACHE_LAST_RUN = new Date().toISOString();
    res.json({ ok: true, updated: all.length });
  } catch (e) {
    res.status(500).json({ error: String(e?.message || e) });
  }
});

// Fast cached response for Google Sheets
app.get("/api/masters", (_req, res) => {
  res.json({
    total_rows: CACHE_ROWS.length,
    rows: CACHE_ROWS,
    columns: [
      "Event plus Cat","Event","City","Date","Category","Gender",
      "Gold","Time1","Silver","Time2","Bronze","Time3"
    ],
    last_run: CACHE_LAST_RUN
  });
});

app.get("/", (_req, res) => {
  res.send("HYROX Masters Scraper (Rome test) is running ✅  Use /api/update-masters then /api/masters");
});

app.listen(PORT, () => {
  console.log(`✅ Server listening on :${PORT}`);
});
