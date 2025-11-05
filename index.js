// index.js
// HYROX Masters Scraper v4.1 (Fly.io friendly, no Playwright)
// - MEN + WOMEN Masters (45-49 ... 70-74)
// - Gold/Silver/Bronze names + times
// - Robust parsing against hyresult table structure
// - Skips/annotates missing podiums
// - Disk cache for fast /api/masters
// - Test single event: /api/update-masters?only_event=s8-2025-rome

import express from "express";
import * as cheerio from "cheerio";
import fs from "fs/promises";
import path from "path";
import { fileURLToPath } from "url";

// ------------------------ Basics ------------------------
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const PORT = process.env.PORT ? Number(process.env.PORT) : 8080;
const HOST = "0.0.0.0";

const CACHE_DIR = "/data";
const CACHE_FILE = path.join(CACHE_DIR, "masters_cache.json");

// Canonical events list (do not change this URL)
const EVENTS_TXT_URL =
  "https://raw.githubusercontent.com/axsion/HyroxScraper/main/events.txt";

// Masters age groups (HYRESULT)
const AGE_GROUPS = ["45-49", "50-54", "55-59", "60-64", "65-69", "70-74"];

// Two categories we scrape for each event
const CATEGORIES = [
  { gender: "MEN", path: "hyrox-men" },
  { gender: "WOMEN", path: "hyrox-women" },
];

// HTTP helper
async function httpGet(url) {
  const res = await fetch(url, {
    headers: {
      "user-agent":
        "Mozilla/5.0 (compatible; HyroxMastersScraper/4.1; +https://hyroxscraper.fly.dev)",
      "accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
      "accept-language": "en",
    },
  });
  if (!res.ok) throw new Error(`GET ${url} -> ${res.status}`);
  return res.text();
}

// Ensure cache dir/file
async function ensureCache() {
  try {
    await fs.mkdir(CACHE_DIR, { recursive: true });
  } catch (_) {}
  try {
    await fs.access(CACHE_FILE);
  } catch (_) {
    await fs.writeFile(
      CACHE_FILE,
      JSON.stringify({ last_run: null, rows: [], columns: columnsSchema() }, null, 2),
      "utf-8"
    );
  }
}

function columnsSchema() {
  return [
    "Event plus Cat",
    "Event",
    "City",
    "Date",
    "Category",
    "Gender",
    "Gold",
    "Time1",
    "Silver",
    "Time2",
    "Bronze",
    "Time3",
  ];
}

async function loadCache() {
  await ensureCache();
  const raw = await fs.readFile(CACHE_FILE, "utf-8");
  return JSON.parse(raw);
}

async function saveCache(obj) {
  await ensureCache();
  await fs.writeFile(CACHE_FILE, JSON.stringify(obj, null, 2), "utf-8");
}

// Load canonical events list (dedupe + sanitize)
async function loadEventSlugs() {
  const txt = await httpGet(EVENTS_TXT_URL);
  const lines = txt
    .split(/\r?\n/)
    .map((s) => s.trim())
    .filter(Boolean);

  // allow lines that might be full URLs or slugs
  const slugs = lines.map((line) => {
    // if full URL from hyresult
    const m = line.match(/hyresult\.com\/event\/([^/\s]+)/i);
    if (m) return m[1].trim();
    return line.replace(/^\/?event\//, "").trim();
  });

  // dedupe, keep order
  const seen = new Set();
  const out = [];
  for (const s of slugs) {
    if (!seen.has(s)) {
      seen.add(s);
      out.push(s);
    }
  }
  return out;
}

// Parse helpers
function normText(t) {
  return (t || "").replace(/\s+/g, " ").trim();
}

function extractTimeFromRow($, $row) {
  // find the first cell that looks like a time HH:MM:SS
  const tds = $row.find("td").toArray();
  for (const td of tds) {
    const text = normText($(td).text());
    const time = (text.match(/\b\d{2}:\d{2}:\d{2}\b/) || [])[0];
    if (time) return time;
  }
  // fallback: sometimes time may be in a span with class
  const timeSpan = $row.find('span,div').toArray().map((n) => normText($(n).text()))
    .find((s) => /\b\d{2}:\d{2}:\d{2}\b/.test(s));
  if (timeSpan) return (timeSpan.match(/\b\d{2}:\d{2}:\d{2}\b/) || [])[0];
  return "";
}

function extractNameFromRow($, $row) {
  // Prefer athlete link
  const link = $row.find('a[href^="/athlete/"]').first();
  if (link && link.length) {
    const name = normText(link.text());
    if (name) return name;
  }
  // Otherwise try likely name cell: often 2nd td
  const tds = $row.find("td");
  if (tds.length >= 2) {
    const maybeName = normText($(tds[1]).text());
    if (maybeName && !/^\d+(:\d+){1,2}$/.test(maybeName)) return maybeName;
  }
  // Fallback: scan for the longest non-numeric chunk
  let best = "";
  $row.find("td").each((_, td) => {
    const txt = normText($(td).text());
    if (txt && !/^\d+(:\d+){1,2}$/.test(txt) && txt.length > best.length) {
      best = txt;
    }
  });
  return best;
}

function extractCityFromEventTitle(eventTitle) {
  // eventTitle like "Ranking of 2025 Birmingham HYROX MEN"
  // Try to grab the token before HYROX
  // Split and find HYROX index
  const parts = eventTitle.split(/\s+/);
  const idx = parts.findIndex((p) => p.toUpperCase() === "HYROX");
  if (idx > 1) return parts[idx - 1];
  // fallback: try a capitalized word near end
  const m = eventTitle.match(/\b([A-Z][a-zA-Z-]+)\b(?!.*\b[A-Z][a-zA-Z-]+\b)/);
  return m ? m[1] : "";
}

function extractYearFromEventTitle(eventTitle) {
  const m = eventTitle.match(/\b(20\d{2})\b/);
  return m ? m[1] : "";
}

function buildEventTitle(citySlug, genderLabel) {
  // citySlug like "s8-2025-birmingham"
  // Rebuild a generic title, but we'll replace City from page when available
  // NOTE: Page title usually provides "Ranking of 2025 Birmingham HYROX MEN"
  return `Ranking of 2025 ${citySlug} HYROX ${genderLabel}`;
}

// Parse a single ranking page to get top 3
function parsePodium(html) {
  const $ = cheerio.load(html);

  // Title often contains "Ranking of 2025 City HYROX MEN/WOMEN"
  const pageTitle =
    normText($('h1, h2').first().text()) ||
    normText($('title').text()) ||
    "";

  // Find rows: prefer a main table
  let rows = $('table tbody tr').toArray();
  if (!rows.length) {
    // fallback: any tr with rank in first cell
    rows = $('tr').toArray();
  }

  // Collect by detecting rank (1,2,3) in the first cell
  const podium = {};
  for (const tr of rows) {
    const $tr = $(tr);
    const tds = $tr.find("td");
    if (!tds.length) continue;

    // First cell should be Rank or contains it
    const firstCellText = normText($(tds[0]).text()).replace(/[^\d]/g, "");
    if (!firstCellText) continue;
    const rank = Number(firstCellText);
    if (![1, 2, 3].includes(rank)) continue;

    const name = extractNameFromRow($, $tr);
    const time = extractTimeFromRow($, $tr);

    if (name || time) {
      podium[rank] = { name, time };
    }
    if (Object.keys(podium).length === 3) break;
  }

  return {
    title: pageTitle,
    gold: podium[1] || { name: "", time: "" },
    silver: podium[2] || { name: "", time: "" },
    bronze: podium[3] || { name: "", time: "" },
  };
}

// Build URL for a given event/gender/age group
function rankingUrl(slug, genderPath, age) {
  return `https://www.hyresult.com/ranking/${slug}-${genderPath}?ag=${encodeURIComponent(
    age
  )}`;
}

// ------------------------ Scrape Orchestrator ------------------------
async function scrapeOneCombo(slug, genderLabel, genderPath, age) {
  const url = rankingUrl(slug, genderPath, age);
  try {
    const html = await httpGet(url);
    const parsed = parsePodium(html);

    // Extract nice metadata
    const eventTitle = parsed.title || buildEventTitle(slug, genderLabel);
    const city = extractCityFromEventTitle(eventTitle) || slug.split("-").pop();
    const year = extractYearFromEventTitle(eventTitle) || (slug.match(/\b(20\d{2})\b/)?.[1] || "");

    // If no gold/silver/bronze found, return "no podium" line
    const noData =
      !parsed.gold.name && !parsed.silver.name && !parsed.bronze.name;

    if (noData) {
      return [
        `No podium available for ${slug}-${genderPath}?ag=${age}`,
        `${slug}-${genderPath}?ag=${age}`,
        "",
        "",
        age,
        genderLabel,
        "",
        "",
        "",
        "",
        "",
        "",
      ];
    }

    // Option 1 format (single row per age group): Gold/Silver/Bronze in columns
    const row = [
      `${eventTitle}${age}`, // Event plus Cat
      eventTitle.replace(/\s+/g, " ").trim(), // Event
      city,
      year,
      age,
      genderLabel,
      parsed.gold.name || "",
      parsed.gold.time || "",
      parsed.silver.name || "",
      parsed.silver.time || "",
      parsed.bronze.name || "",
      parsed.bronze.time || "",
    ];
    return row;
  } catch (err) {
    // Network/404/etc → add a "no podium available" row
    return [
      `No podium available for ${slug}-${genderPath}?ag=${age}`,
      `${slug}-${genderPath}?ag=${age}`,
      "",
      "",
      age,
      genderLabel,
      "",
      "",
      "",
      "",
      "",
      "",
    ];
  }
}

async function scrapeEventMasters(slug) {
  const rows = [];
  for (const cat of CATEGORIES) {
    for (const ag of AGE_GROUPS) {
      const row = await scrapeOneCombo(slug, cat.gender, cat.path, ag);
      rows.push(row);
    }
  }
  return rows;
}

async function runFullScrape({ onlyEvent } = {}) {
  const eventSlugs = await loadEventSlugs();
  const slugs = onlyEvent
    ? eventSlugs.filter((s) => s === onlyEvent)
    : eventSlugs;

  const allRows = [];
  for (const slug of slugs) {
    const eventRows = await scrapeEventMasters(slug);
    allRows.push(...eventRows);
  }
  return allRows;
}

// ------------------------ Express API ------------------------
const app = express();

// health
app.get("/api/health", (_req, res) => {
  res.json({ ok: true, now: new Date().toISOString() });
});

// update cache
// Optional: ?only_event=s8-2025-rome
app.get("/api/update-masters", async (req, res) => {
  try {
    const onlyEvent = (req.query.only_event || "").toString().trim() || null;

    const rows = await runFullScrape({ onlyEvent });

    const cache = {
      last_run: new Date().toISOString(),
      rows,
      columns: columnsSchema(),
    };
    await saveCache(cache);

    res.json({ ok: true, updated: rows.length, only_event: onlyEvent || null });
  } catch (err) {
    res.status(500).json({ ok: false, error: String(err) });
  }
});

// read cache
app.get("/api/masters", async (_req, res) => {
  try {
    const cache = await loadCache();
    res.json({
      total_rows: cache.rows.length,
      rows: cache.rows,
      columns: cache.columns,
      last_run: cache.last_run,
    });
  } catch (err) {
    res.status(500).json({ ok: false, error: String(err) });
  }
});

// root
app.get("/", (_req, res) => {
  res.type("text/plain").send("HYROX Masters Scraper v4.1 – /api/health | /api/update-masters | /api/masters");
});

// Listen (Fly needs 0.0.0.0)
app.listen(PORT, HOST, () => {
  console.log(`HYROX Masters Scraper listening on http://${HOST}:${PORT}`);
});
