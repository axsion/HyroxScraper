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

// City mapping (for pretty display)
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

const AGE_GROUPS = ["45-49", "50-54", "55-59", "60-64", "65-69", "70-74"];
const GENDERS = [
  { key: "men", label: "MEN" },
  { key: "women", label: "WOMEN" },
];

// ---------------- UTILS ----------------

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

function parseEventSlug(slug) {
  // e.g. "s8-2025-rome" → year="2025", cityKey="rome"
  const parts = slug.split("-");
  const year = parts[1] || "";
  const cityKey = parts.slice(2).join("-");
  const city = CITY_MAP[cityKey] || cityKey;
  return { city, year };
}

function formatEvent(city, year, gender) {
  // Event (no category)
  return `${city} ${year} - ${gender}`;
}
function formatEventPlusCat(city, year, gender, category) {
  // Unique key for row
  return `${city} ${year} - ${gender} - ${category}`;
}

function isTimeLike(text) {
  // matches 00:59:59 or 1:02:35 or 59:59 (handle missing hours occasionally)
  return /^\d{1,2}:\d{2}(:\d{2})?$/.test(text.trim());
}

async function readEventsList() {
  try {
    const r = await fetch(EVENTS_URL, { timeout: 10000 });
    if (!r.ok) throw new Error(`Remote events list HTTP ${r.status}`);
    const body = await r.text();
    const slugs = body.split("\n").map(s => s.trim()).filter(Boolean);
    if (slugs.length === 0) throw new Error("Remote events list empty");
    return slugs;
  } catch (e) {
    // Fallback to local events.txt
    if (fs.existsSync(EVENTS_FILE)) {
      const body = fs.readFileSync(EVENTS_FILE, "utf8");
      return body.split("\n").map(s => s.trim()).filter(Boolean);
    }
    throw new Error(`No events list available: ${e.message}`);
  }
}

// ---------------- CORE SCRAPER ----------------

function parsePodiumFromTable($) {
  const table = $("table:has(tbody tr)").first();
  if (!table.length) return null;

  const tbodyRows = table.find("tbody tr");
  if (!tbodyRows.length) return null;

  // given structure:
  // td[0] = menu icon
  // td[1] = bib number (ignore)
  // td[2] = rank
  // td[3] = name (contains flag img + <a>)
  // td[4] = AG (we already know)
  // td[5] = time
  // td[6] = empty (ignore)

  function cleanName(cell) {
    // remove flag <img> and extract link text
    const txt = $(cell).text().trim();
    return txt.replace(/\s+/g, " ");
  }

  function extract(rowIndex) {
    const tr = tbodyRows.eq(rowIndex);
    if (!tr.length) return null;
    const tds = tr.find("td");
    if (tds.length < 6) return null;

    let rank = tds.eq(2).text().trim();
    let name = cleanName(tds.eq(3));
    let time = tds.eq(5).text().trim();

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
  const res = await fetch(url, { timeout: 20000 });
  if (!res.ok) return null;
  const html = await res.text();
  const $ = cheerio.load(html);
  const podium = parsePodiumFromTable($);
  if (!podium || !podium.gold) return null;
  return podium;
}

async function buildRowFromPodium(slug, category, genderLabel, podium) {
  const { city, year } = parseEventSlug(slug);
  return {
    "Event": formatEvent(city, year, genderLabel),
    "City": city,
    "Date": year,
    "Category": category,
    "Gender": genderLabel,
    "Gold": podium.gold?.name || "",
    "Time1": podium.gold?.time || "",
    "Silver": podium.silver?.name || "",
    "Time2": podium.silver?.time || "",
    "Bronze": podium.bronze?.name || "",
    "Time3": podium.bronze?.time || "",
    // internal unique key (not written to Sheets but useful for dedup)
    "_key": formatEventPlusCat(city, year, genderLabel, category),
  };
}

async function scrapeOneSlug(slug) {
  const out = [];
  for (const ag of AGE_GROUPS) {
    for (const g of GENDERS) {
      const url = `https://www.hyresult.com/ranking/${slug}-hyrox-${g.key}?ag=${ag}`;
      const podium = await scrapeCategory(url);
      if (!podium) continue;
      const row = await buildRowFromPodium(slug, ag, g.label, podium);
      out.push(row);
    }
  }
  return out;
}

// ---------------- UPDATE / CACHE ----------------

function dedupeAndMerge(existingRows, newRows) {
  // Remove any existing row with the same _key, then add the new one
  const map = new Map();
  for (const r of existingRows) {
    if (r && r._key) map.set(r._key, r);
  }
  for (const r of newRows) {
    if (r && r._key) map.set(r._key, r);
  }
  return Array.from(map.values());
}

async function updateAll(slugs) {
  const sheet = loadSheet();
  let merged = sheet.rows || [];
  let totalAdded = 0;

  for (const slug of slugs) {
    const rows = await scrapeOneSlug(slug);
    merged = dedupeAndMerge(merged, rows);
    totalAdded += rows.length;
  }

  saveSheet({ rows: merged, last_run: new Date().toISOString() });
  return { added: totalAdded, total_rows: merged.length };
}

async function updateOne(slug) {
  const sheet = loadSheet();
  const rows = await scrapeOneSlug(slug);
  const merged = dedupeAndMerge(sheet.rows || [], rows);
  saveSheet({ rows: merged, last_run: new Date().toISOString() });
  return { added: rows.length, total_rows: merged.length, rows };
}

// ---------------- MIDDLEWARE ----------------

app.use((req, res, next) => {
  // CORS for Google Apps Script
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET,OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  if (req.method === "OPTIONS") return res.status(200).end();
  next();
});

// ---------------- API ROUTES ----------------

app.get("/api/health", (req, res) => {
  try {
    const s = loadSheet();
    res.json({
      ok: true,
      status: "healthy",
      last_run: s.last_run || null,
      cached_rows: (s.rows || []).length,
      events_source: EVENTS_URL,
    });
  } catch {
    res.json({ ok: true, status: "healthy", cached_rows: 0, events_source: EVENTS_URL });
  }
});

app.get("/api/check-events", async (req, res) => {
  try {
    const slugs = await readEventsList();
    res.json({ total: slugs.length, results: slugs.slice(0, 50), sample: slugs.slice(0, 5) });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.get("/api/scrape", async (req, res) => {
  // Scrape/update a single event by slug
  try {
    const slug = (req.query.slug || "").trim();
    if (!slug) return res.status(400).json({ error: "Missing ?slug=" });
    const result = await updateOne(slug);
    // return only the rows for this slug (without _key)
    const cleaned = (result.rows || []).map(({ _key, ...r }) => r);
    res.json({ ok: true, slug, added: result.added, rows: cleaned });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.get("/api/scrape-all", async (req, res) => {
  try {
    const slugs = await readEventsList();
    const result = await updateAll(slugs);
    res.json({ ok: true, ...result });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.get("/api/masters", (req, res) => {
  const s = loadSheet();
  // Strip internal key
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

// ---------------- START ----------------

app.listen(PORT, () => console.log(`✅ Server running on port ${PORT}`));
