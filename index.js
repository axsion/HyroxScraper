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

const EVENTS_FILE = path.join(__dirname, "events.txt");

// City name mapping
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

// Age groups + genders
const AGE_GROUPS = ["45-49", "50-54", "55-59", "60-64", "65-69", "70-74"];
const GENDERS = [
  { key: "men", label: "MEN" },
  { key: "women", label: "WOMEN" }
];

// Output sheet
const SHEET_FILE = path.join(__dirname, "masters.json");

// ---------------- HELPERS ----------------

function parseEventSlug(slug) {
  // e.g., "s8-2025-rome" → "rome", "2025"
  const parts = slug.split("-");
  const year = parts[1];
  const cityKey = parts.slice(2).join("-");
  const city = CITY_MAP[cityKey] || cityKey;
  return { city, year };
}

function formatDisplay(city, year, gender, category) {
  return `${city} ${year} - ${gender} - ${category}`;
}

function ensureSheet() {
  if (!fs.existsSync(SHEET_FILE)) {
    fs.writeFileSync(SHEET_FILE, JSON.stringify([]));
  }
}

function loadSheet() {
  ensureSheet();
  return JSON.parse(fs.readFileSync(SHEET_FILE, "utf8"));
}

function saveSheet(rows) {
  fs.writeFileSync(SHEET_FILE, JSON.stringify(rows, null, 2));
}

// ---------------- SCRAPER ----------------

async function scrapePodium(url, eventSlug, category, genderLabel) {
  const res = await fetch(url);
  if (!res.ok) return null;
  const html = await res.text();

  const $ = cheerio.load(html);

  // HYROX result table selector
  const table = $("table.table-bordered.table-striped");
  if (!table.length) return null;

  const rows = table.find("tbody tr");

  const get = (i) => {
    const row = rows.eq(i);
    if (!row.length) return null;
    const name = row.find("td").eq(1).text().trim();
    const rank = row.find("td").eq(0).text().trim();
    if (!name) return null;
    return { rank, name };
  };

  const gold = get(0);
  const silver = get(1);
  const bronze = get(2);

  if (!gold) return null;

  const { city, year } = parseEventSlug(eventSlug);
  return {
    "Event plus Cat": formatDisplay(city, year, genderLabel, category),
    "Event": formatDisplay(city, year, genderLabel, ""),
    "City": city,
    "Date": year,
    "Category": category,
    "Gender": genderLabel,
    "Gold": gold.rank,
    "Time1": gold.name,
    "Silver": silver ? silver.rank : "",
    "Time2": silver ? silver.name : "",
    "Bronze": bronze ? bronze.rank : "",
    "Time3": bronze ? bronze.name : "",
  };
}

// ---------------- UPDATE LOGIC ----------------

async function updateMasters(onlySlug = null) {
  const events = fs.readFileSync(EVENTS_FILE, "utf8")
    .split("\n")
    .map(l => l.trim())
    .filter(Boolean);

  let sheet = loadSheet();
  let updated = 0;

  for (const slug of events) {
    if (onlySlug && slug !== onlySlug) continue;

    for (const category of AGE_GROUPS) {
      for (const gender of GENDERS) {
        const url = `https://www.hyresult.com/ranking/${slug}-hyrox-${gender.key}?ag=${category}`;
        const row = await scrapePodium(url, slug, category, gender.label);
        if (!row) continue;

        sheet = sheet.filter(r => !(r["Event plus Cat"] === row["Event plus Cat"]));
        sheet.push(row);
        updated++;
      }
    }
  }

  saveSheet(sheet);
  return updated;
}

// ---------------- API ROUTES ----------------

app.get("/api/masters", (req, res) => {
  const sheet = loadSheet();
  res.json({
    total_rows: sheet.length,
    rows: sheet,
    columns: Object.keys(sheet[0] || {}),
    last_run: sheet.length
  });
});

app.get("/api/update-masters", async (req, res) => {
  try {
    const slug = req.query.slug || null;
    const updated = await updateMasters(slug);
    res.json({ ok: true, updated });
  } catch (err) {
    res.json({ error: err.message });
  }
});

app.get("/", (_, res) => {
  res.send("HYROX Masters Scraper Running ✅");
});

// ---------------- START ----------------

app.listen(PORT, () => console.log(`✅ Server running on port ${PORT}`));
