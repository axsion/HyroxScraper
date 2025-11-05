/**
 * HYROX Masters Podium Scraper (Top 3 only, MEN & WOMEN)
 * - No Chromium required (fast, cheap)
 * - Works on Fly.io
 * - Reads canonical events list from GitHub (events.txt)
 * - Endpoints:
 *     GET /api/masters          -> all podium rows
 *     GET /api/masters/:slug    -> one event only
 *     GET /api/health           -> {status:"ok"}
 *     GET /api/last-run         -> {ts, count}
 *     GET /api/scrape-all       -> alias to /api/masters (for backward compat)
 *
 * Output columns (exact order):
 *  ["Event plus Cat","Event","City","Date","Category","Gender",
 *   "Gold","Time1","Silver","Time2","Bronze","Time3"]
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

// ---------- Basics & hardening ----------
app.use((req, res, next) => {
  // CORS + allow Apps Script
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, User-Agent");
  res.setHeader("Access-Control-Allow-Methods", "GET, OPTIONS");
  if (req.method === "OPTIONS") return res.status(200).end();
  if (!req.headers["user-agent"]) req.headers["user-agent"] = "Google-Apps-Script";
  next();
});

// ---------- Config ----------
const EVENTS_TXT =
  "https://raw.githubusercontent.com/axsion/HyroxScraper/main/events.txt";
const AGE_GROUPS = ["45-49","50-54","55-59","60-64","65-69","70-74"]; // per your list
const GENDERS = ["hyrox-men", "hyrox-women"];

// ---------- Small helpers ----------
const cacheFile = path.join("/data", "masters_cache.json");
function readCache() {
  try {
    return JSON.parse(fs.readFileSync(cacheFile, "utf8"));
  } catch {
    return { lastRun: null, rows: [] };
  }
}
function writeCache(obj) {
  try {
    fs.mkdirSync(path.dirname(cacheFile), { recursive: true });
    fs.writeFileSync(cacheFile, JSON.stringify(obj, null, 2));
  } catch { /* ignore */ }
}

// robust fetch with headers + retry
async function get(url, tries = 3) {
  let lastErr;
  for (let i = 0; i < tries; i++) {
    try {
      const r = await fetch(url, {
        headers: {
          "User-Agent": "HYROX-Masters-Scraper/1.0 (+fly.io)",
          "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
        },
        redirect: "follow",
      });
      if (r.status >= 200 && r.status < 300) {
        return await r.text();
      }
      lastErr = new Error(`HTTP ${r.status} for ${url}`);
    } catch (e) {
      lastErr = e;
    }
    await new Promise(r => setTimeout(r, 500 + i * 500));
  }
  throw lastErr;
}

// Format helpers from slug like s8-2025-rome
function parseSlug(slug) {
  // s8-2025-rome, s7-2025-berlin, etc.
  const parts = slug.split("-");
  const year = parts.find(p => /^\d{4}$/.test(p)) || "";
  const cityRaw = parts[parts.length - 1] || "";
  const city = cityRaw.replace(/-/g, " ").replace(/\b\w/g, c => c.toUpperCase());
  return { year, city };
}
function eventTitle({year, city, gender}) {
  // "Ranking of 2025 Rome HYROX MEN"
  const g = gender.includes("women") ? "WOMEN" : "MEN";
  return `Ranking of ${year} ${city} HYROX ${g}`;
}

// Extracts top-3 (Gold/Silver/Bronze) rows from a category page
function extractTop3(html) {
  const $ = cheerio.load(html);

  // The table has tailwind classes; safest is generic tbody > tr
  const trs = $("table tbody tr");
  if (!trs || trs.length === 0) return [];

  // Pull the first three rows and detect name/time robustly.
  const timeRe = /^\d{1,2}:\d{2}(?::\d{2})?$/; // e.g., 58:27 or 1:05:25
  const top = [];
  trs.slice(0, 3).each((_, tr) => {
    const $tr = $(tr);
    const tds = $tr.find("td").toArray().map(td => $(td).text().trim());

    // Name: prefer anchor with /athlete/
    let name = $tr.find('a[href^="/athlete/"]').first().text().trim();
    if (!name) {
      // Fallback: first cell that has letters and spaces and length > 0
      name = tds.find(s => /[A-Za-z][A-Za-z\s'.-]{1,}/.test(s)) || "";
    }

    // Time: first cell matching timeRe
    const time = tds.find(s => timeRe.test(s)) || "";

    if (name && time) top.push({ name, time });
  });

  // return only if we have 3 persons (Gold/Silver/Bronze)
  return top.length === 3 ? top : [];
}

async function scrapeEventForGenderAndAG(slug, gender, ag) {
  const base = `https://www.hyresult.com/ranking/${slug}-${gender}`;
  const url = `${base}?ag=${encodeURIComponent(ag)}`;
  const html = await get(url);
  return extractTop3(html);
}

async function scrapeEvent(slug) {
  const outRows = [];
  const { year, city } = parseSlug(slug);

  for (const gender of GENDERS) {
    const gLabel = gender.includes("women") ? "WOMEN" : "MEN";
    const evt = eventTitle({ year, city, gender });

    for (const ag of AGE_GROUPS) {
      try {
        const trio = await scrapeEventForGenderAndAG(slug, gender, ag);
        if (trio.length === 3) {
          // build spreadsheet row in your exact schema
          const plus = `${evt}${ag}`;
          outRows.push([
            plus,                   // Event plus Cat
            evt,                    // Event
            city,                   // City
            year,                   // Date (year)
            ag,                     // Category
            gLabel,                 // Gender
            trio[0].name,           // Gold
            trio[0].time,           // Time1
            trio[1].name,           // Silver
            trio[1].time,           // Time2
            trio[2].name,           // Bronze
            trio[2].time            // Time3
          ]);
        }
      } catch (e) {
        // swallow single-page errors, continue
      }
    }
  }
  return outRows;
}

async function loadEvents() {
  const txt = await get(EVENTS_TXT);
  return txt
    .split("\n")
    .map(l => l.trim())
    .filter(Boolean);
}

// ---------- API ----------
app.get("/api/health", (_req, res) => res.json({ status: "ok" }));

app.get("/api/last-run", (_req, res) => {
  const c = readCache();
  res.json({ ts: c.lastRun, count: Array.isArray(c.rows) ? c.rows.length : 0 });
});

// Backward compatibility
app.get("/api/scrape-all", (_req, res) => res.redirect(302, "/api/masters"));

app.get("/api/masters/:slug", async (req, res) => {
  try {
    const slug = req.params.slug;
    const rows = await scrapeEvent(slug);
    res.json({
      total_rows: rows.length,
      rows,
      columns: [
        "Event plus Cat","Event","City","Date","Category","Gender",
        "Gold","Time1","Silver","Time2","Bronze","Time3"
      ]
    });
  } catch (e) {
    res.status(500).json({ error: String(e && e.message || e) });
  }
});

app.get("/api/masters", async (_req, res) => {
  try {
    const slugs = await loadEvents();
    const allRows = [];
    for (const slug of slugs) {
      const rows = await scrapeEvent(slug);
      if (rows.length) allRows.push(...rows);
    }

    // cache
    writeCache({ lastRun: new Date().toISOString(), rows: allRows });

    res.json({
      total_rows: allRows.length,
      rows: allRows,
      columns: [
        "Event plus Cat","Event","City","Date","Category","Gender",
        "Gold","Time1","Silver","Time2","Bronze","Time3"
      ]
    });
  } catch (e) {
    res.status(500).json({ error: String(e && e.message || e) });
  }
});

app.listen(PORT, () =>
  console.log(`HYROX Masters API running on :${PORT}`)
);
