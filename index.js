import express from "express";
import fetch from "node-fetch";
import * as cheerio from "cheerio";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PORT = process.env.PORT || 10000;

const app = express();

// ---------------- CONFIG ----------------

// Canonical remote events list (fallback to local ./events.txt if fetch fails)
const EVENTS_URL = "https://raw.githubusercontent.com/axsion/HyroxScraper/main/events.txt";
const EVENTS_FILE = path.join(__dirname, "events.txt");

// Output cache (ok to be ephemeral on Fly / Render)
const SHEET_FILE = path.join(__dirname, "masters.json");

// Season-aware age groups (apply to BOTH SOLO & DOUBLES)
// Note: for S7 we try BOTH the full masters set and the legacy wide set.
// We'll attempt all candidates, keep the ones that return a podium, and dedupe.
const AGE_GROUPS = {
  s8: [["45-49","50-54","55-59","60-64","65-69","70-74","75-79"]],
  s7: [
    ["45-49","50-54","55-59","60-64","65-69","70-74","75-79"], // full masters variant (some S7 pages use this)
    ["40-49","50-59","60-69"],                                // legacy wide variant
  ],
};

// Event types (SOLO + DOUBLES)
const EVENT_TYPES = [
  { key: "hyrox-men",           label: "MEN" },
  { key: "hyrox-women",         label: "WOMEN" },
  { key: "hyrox-doubles-men",   label: "DOUBLES MEN" },
  { key: "hyrox-doubles-women", label: "DOUBLES WOMEN" },
  { key: "hyrox-doubles-mixed", label: "DOUBLES MIXED" },
];

// City mapping for display
const CITY_MAP = {
  "birmingham": "Birmingham",
  "paris": "Paris",
  "valencia": "Valencia",
  "gdansk": "Gdansk",
  "geneva": "Geneva",
  "hamburg": "Hamburg",
  "toronto": "Toronto",
  "oslo": "Oslo",
  "rome": "Rome",
  "boston": "Boston",
  "maastricht": "Maastricht",
  "sao-paulo": "São Paulo",
  "acapulco": "Acapulco",
  "perth": "Perth",
  "mumbai": "Mumbai",
  "beijing": "Beijing",
  "yokohama": "Yokohama",
  "hong-kong": "Hong Kong",
  "cape-town": "Cape Town",
  "new-delhi": "New Delhi",
  "abu-dhabi": "Abu Dhabi",
  "sydney": "Sydney",
  "singapore": "Singapore",
  "new-york": "New York",
  "rimini": "Rimini",
  "cardiff": "Cardiff",
  "riga": "Riga",
  "bangkok": "Bangkok",
  "berlin": "Berlin",
};

// ---------------- SHEET HELPERS ----------------

function ensureSheet() {
  if (!fs.existsSync(SHEET_FILE)) {
    fs.writeFileSync(SHEET_FILE, JSON.stringify({ rows: [], last_run: null }, null, 2));
  }
}
function loadSheet() {
  ensureSheet();
  return JSON.parse(fs.readFileSync(SHEET_FILE, "utf8"));
}
function saveSheet(payload) {
  fs.writeFileSync(SHEET_FILE, JSON.stringify(payload, null, 2));
}

// ---------------- GENERAL HELPERS ----------------

function parseEventSlug(slug) {
  const parts = slug.split("-");
  const year = parts[1];
  const cityKey = parts.slice(2).join("-");
  const city = CITY_MAP[cityKey] || cityKey;
  return { city, year };
}

function formatEvent(city, year, gender) {
  return `${city} ${year} - ${gender}`;
}

function getSeasonFromSlug(slug) {
  return slug.split("-")[0]; // "s8" or "s7"
}

async function readEventsList() {
  try {
    const r = await fetch(EVENTS_URL);
    if (!r.ok) throw new Error();
    const body = await r.text();
    const slugs = body.split("\n").map(s => s.trim()).filter(Boolean);
    return slugs;
  } catch {
    if (fs.existsSync(EVENTS_FILE)) {
      return fs.readFileSync(EVENTS_FILE, "utf8").split("\n").map(s => s.trim()).filter(Boolean);
    }
    throw new Error("No events list available");
  }
}

// ---------------- PODIUM PARSER (MATCHES CURRENT HTML) ----------------

function parsePodiumFromTable($) {
  const table = $("table:has(tbody tr)").first();
  if (!table.length) return null;

  const tbodyRows = table.find("tbody tr");
  if (!tbodyRows.length) return null;

  function cleanName(cell) {
    return $(cell).text().trim().replace(/\s+/g, " ");
  }

  function extract(i) {
    const tr = tbodyRows.eq(i);
    if (!tr.length) return null;
    const tds = tr.find("td");
    if (tds.length < 6) return null;

    // Observed structure:
    // td[0] menu icon, td[1] bib, td[2] rank, td[3] name, td[4] AG, td[5] time, td[6] empty
    const rank = tds.eq(2).text().trim();
    const name = cleanName(tds.eq(3));
    const time = tds.eq(5).text().trim();

    if (!name) return null;
    return { rank, name, time };
  }

  return {
    gold: extract(0),
    silver: extract(1),
    bronze: extract(2),
  };
}

async function scrapeCategory(url) {
  const res = await fetch(url);
  if (!res.ok) return null;
  const html = await res.text();
  const $ = cheerio.load(html);
  const podium = parsePodiumFromTable($);
  return podium && podium.gold ? podium : null;
}

async function buildRow(slug, category, genderLabel, podium) {
  const { city, year } = parseEventSlug(slug);
  return {
    Event: formatEvent(city, year, genderLabel),
    City: city,
    Date: year,
    Category: category,
    Gender: genderLabel,
    Gold: podium.gold?.name || "",
    Time1: podium.gold?.time || "",
    Silver: podium.silver?.name || "",
    Time2: podium.silver?.time || "",
    Bronze: podium.bronze?.name || "",
    Time3: podium.bronze?.time || "",
    _key: `${city}-${year}-${genderLabel}-${category}`,
  };
}

// ---------------- SCRAPE ONE EVENT ----------------

async function scrapeOneSlug(slug) {
  const out = [];
  const season = getSeasonFromSlug(slug); // "s8" or "s7"
  const variants = AGE_GROUPS[season] || [[]]; // array of arrays

  for (const ageList of variants) {
    for (const ag of ageList) {
      for (const evt of EVENT_TYPES) {
        const url = `https://www.hyresult.com/ranking/${slug}-${evt.key}?ag=${encodeURIComponent(ag)}`;
        const podium = await scrapeCategory(url);
        if (!podium) continue;
        const row = await buildRow(slug, ag, evt.label, podium);
        out.push(row);
      }
    }
  }

  return out;
}

// ---------------- MERGE & UPDATE CACHE ----------------

function dedupeRows(rows) {
  const map = new Map();
  for (const r of rows) {
    if (r && r._key) map.set(r._key, r);
  }
  return Array.from(map.values());
}

async function updateOne(slug) {
  const cache = loadSheet();
  const newRows = await scrapeOneSlug(slug);
  const merged = dedupeRows([...(cache.rows || []), ...newRows]);
  saveSheet({ rows: merged, last_run: new Date().toISOString() });
  return newRows.length;
}

async function updateAll() {
  const slugs = await readEventsList();
  let added = 0;
  for (const slug of slugs) {
    added += await updateOne(slug);
  }
  return added;
}

// ---------------- API ----------------

app.use((req, res, next) => {
  res.setHeader("Access-Control-Allow-Origin", "*");
  next();
});

app.get("/api/health", (req, res) => {
  const s = loadSheet();
  res.json({
    ok: true,
    status: "healthy",
    last_run: s.last_run || null,
    cached_rows: (s.rows || []).length,
    events_source: EVENTS_URL,
  });
});

app.get("/api/check-events", async (req, res) => {
  try {
    const slugs = await readEventsList();
    res.json({ total: slugs.length, results: slugs, sample: slugs.slice(0, 5) });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.get("/api/scrape", async (req, res) => {
  try {
    const slug = (req.query.slug || "").trim();
    if (!slug) return res.status(400).json({ error: "Missing ?slug=" });
    const added = await updateOne(slug);
    // Return only rows for this slug for convenience
    const { city, year } = parseEventSlug(slug);
    const s = loadSheet();
    const rows = (s.rows || []).filter(r => r.Event.startsWith(`${city} ${year} -`));
    const cleaned = rows.map(({ _key, ...r }) => r);
    res.json({ ok: true, slug, added, rows: cleaned });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.get("/api/scrape-all", async (req, res) => {
  try {
    const added = await updateAll();
    res.json({ ok: true, added });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.get("/api/masters", (req, res) => {
  const s = loadSheet();
  const rows = (s.rows || []).map(({ _key, ...r }) => r);
  res.json({
    ok: true,
    total_rows: rows.length,
    rows,
    columns: Object.keys(rows[0] || {}),
    last_run: s.last_run || null,
  });
});

app.get("/", (_, res) => {
  res.send("HYROX Masters Scraper Running ✅");
});

app.listen(PORT, () => console.log(`✅ Server running on port ${PORT}`));
