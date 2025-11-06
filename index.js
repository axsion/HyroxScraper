import express from "express";
import fetch from "node-fetch";
import * as cheerio from "cheerio";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PORT = process.env.PORT || 10000;

const app = express();

// ---------------------------------------------------------
// CONFIG
// ---------------------------------------------------------
const EVENTS_URL = "https://raw.githubusercontent.com/axsion/HyroxScraper/main/events.txt";
const EVENTS_FILE = path.join(__dirname, "events.txt");
const SHEET_FILE = path.join(__dirname, "masters.json");

// Age groups
const AGE_GROUPS = {
  s8: [["45-49","50-54","55-59","60-64","65-69","70-74","75-79"]],
  s7: [
    ["45-49","50-54","55-59","60-64","65-69","70-74","75-79"], // newer S7 structure
    ["40-49","50-59","60-69"],                                // older S7 structure
  ],
};

// SOLO + DOUBLES types
const EVENT_TYPES = [
  { key: "hyrox-men", label: "MEN" },
  { key: "hyrox-women", label: "WOMEN" },
  { key: "hyrox-doubles-men", label: "DOUBLES MEN" },
  { key: "hyrox-doubles-women", label: "DOUBLES WOMEN" },
  { key: "hyrox-doubles-mixed", label: "DOUBLES MIXED" },
];

// City mapping for display
const CITY_MAP = {
  "birmingham": "Birmingham","paris": "Paris","valencia": "Valencia","gdansk": "Gdansk",
  "geneva": "Geneva","hamburg": "Hamburg","toronto": "Toronto","oslo": "Oslo","rome": "Rome",
  "boston": "Boston","maastricht": "Maastricht","sao-paulo": "São Paulo","acapulco": "Acapulco",
  "perth": "Perth","mumbai": "Mumbai","beijing": "Beijing","yokohama": "Yokohama",
  "hong-kong": "Hong Kong","cape-town": "Cape Town","new-delhi": "New Delhi","abu-dhabi": "Abu Dhabi",
  "sydney": "Sydney","singapore": "Singapore","new-york": "New York","rimini": "Rimini",
  "cardiff": "Cardiff","riga": "Riga","bangkok": "Bangkok","berlin": "Berlin",
};

// ---------------------------------------------------------
// SHEET HELPERS
// ---------------------------------------------------------
function ensureSheet() {
  if (!fs.existsSync(SHEET_FILE)) {
    fs.writeFileSync(SHEET_FILE, JSON.stringify({ rows: [], last_run: null }, null, 2));
  }
}
function loadSheet() {
  ensureSheet();
  return JSON.parse(fs.readFileSync(SHEET_FILE, "utf8"));
}
function saveSheet(p) {
  fs.writeFileSync(SHEET_FILE, JSON.stringify(p, null, 2));
}

// ---------------------------------------------------------
// GENERAL HELPERS
// ---------------------------------------------------------
function parseEventSlug(slug) {
  const parts = slug.split("-");
  const year = parts[1];
  const cityKey = parts.slice(2).join("-");
  return { city: CITY_MAP[cityKey] || cityKey, year };
}
function getSeason(slug) { return slug.split("-")[0]; }

async function readEventsList() {
  try {
    const r = await fetch(EVENTS_URL);
    const body = await r.text();
    return body.split("\n").map(s => s.trim()).filter(Boolean);
  } catch {
    return fs.existsSync(EVENTS_FILE)
      ? fs.readFileSync(EVENTS_FILE, "utf8").split("\n").map(s => s.trim()).filter(Boolean)
      : [];
  }
}

// ---------------------------------------------------------
// PODIUM PARSER (based on screenshot — stable structure)
// ---------------------------------------------------------
function parsePodiumFromTable($) {
  const table = $("table:has(tbody tr)").first();
  if (!table.length) return null;
  const rows = table.find("tbody tr");
  if (!rows.length) return null;

  function clean(cell) { return $(cell).text().trim().replace(/\s+/g, " "); }

  function one(i) {
    const tds = rows.eq(i).find("td");
    if (tds.length < 6) return null;
    const rank = tds.eq(2).text().trim();
    const name = clean(tds.eq(3));
    const time = tds.eq(5).text().trim();
    return name ? { rank, name, time } : null;
  }

  return { gold: one(0), silver: one(1), bronze: one(2) };
}

async function scrapeCategory(url) {
  const res = await fetch(url);
  if (!res.ok) return null;
  const podium = parsePodiumFromTable(cheerio.load(await res.text()));
  return podium && podium.gold ? podium : null;
}

async function buildRow(slug, category, gender, podium) {
  const { city, year } = parseEventSlug(slug);
  return {
    Event: `${city} ${year} - ${gender} - ${category}`,
    City: city,
    Date: year,
    Category: category,
    Gender: gender,
    Gold: podium.gold?.name || "",
    Time1: podium.gold?.time || "",
    Silver: podium.silver?.name || "",
    Time2: podium.silver?.time || "",
    Bronze: podium.bronze?.name || "",
    Time3: podium.bronze?.time || "",
    _key: `${city}-${year}-${gender}-${category}`
  };
}

// ---------------------------------------------------------
// SCRAPE ONE EVENT
// ---------------------------------------------------------
async function scrapeOneSlug(slug) {
  const out = [];
  for (const variant of (AGE_GROUPS[getSeason(slug)] || [[]])) {
    for (const ag of variant) {
      for (const evt of EVENT_TYPES) {
        const url = `https://www.hyresult.com/ranking/${slug}-${evt.key}?ag=${encodeURIComponent(ag)}`;
        const podium = await scrapeCategory(url);
        if (podium) out.push(await buildRow(slug, ag, evt.label, podium));
      }
    }
  }
  return out;
}

// ---------------------------------------------------------
// MERGE + CACHE
// ---------------------------------------------------------
function dedupe(rows) {
  const m = new Map();
  for (const r of rows) m.set(r._key, r);
  return [...m.values()];
}
async function updateOne(slug) {
  const cache = loadSheet();
  const newRows = await scrapeOneSlug(slug);
  saveSheet({ rows: dedupe([...(cache.rows||[]), ...newRows]), last_run: new Date().toISOString() });
  return newRows.length;
}
async function updateAll() {
  let added = 0;
  for (const slug of await readEventsList()) added += await updateOne(slug);
  return added;
}

// ---------------------------------------------------------
// API
// ---------------------------------------------------------
app.get("/api/health",(_,res)=>res.json(loadSheet()));
app.get("/api/check-events",async(_,res)=>res.json(await readEventsList()));
app.get("/api/scrape",async(req,res)=>res.json({ added: await updateOne(req.query.slug) }));
app.get("/api/scrape-all",async(_,res)=>res.json({ added: await updateAll() }));
app.get("/api/masters",(_,res)=>res.json(loadSheet()));
app.listen(PORT,()=>console.log(`✅ Running on ${PORT}`));
