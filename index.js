import express from "express";
import fetch from "node-fetch";
import cheerio from "cheerio";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const PORT = process.env.PORT || 8080;

const app = express();

const EVENTS_FILE =
  process.env.EVENTS_URL ||
  "https://raw.githubusercontent.com/axsion/HyroxScraper/main/events.txt";

const MASTER_GROUPS = ["45-49", "50-54", "55-59", "60-64", "65-69", "70-74"];
const GENDERS = [
  { slug: "hyrox-men", label: "MEN" },
  { slug: "hyrox-women", label: "WOMEN" },
];

const CACHE_FILE = path.join("/data", "masters_cache.json");

// Load cache
function loadCache() {
  try {
    if (fs.existsSync(CACHE_FILE)) {
      return JSON.parse(fs.readFileSync(CACHE_FILE, "utf8"));
    }
  } catch (_) {}
  return { rows: [], last_run: null };
}

// Save cache
function saveCache(data) {
  fs.writeFileSync(CACHE_FILE, JSON.stringify(data, null, 2));
}

// Parse a podium page
async function scrapePodium(url, eventSlug, group, genderLabel) {
  const res = await fetch(url);
  if (!res.ok) return null;

  const html = await res.text();
  const $ = cheerio.load(html);

  const rows = $("table tbody tr");
  if (rows.length === 0) return null;

  const entries = [];

  rows.slice(0, 3).each((_, el) => {
    const cols = $(el).find("td");
    const name = $(cols[1]).text().trim();
    const time = $(cols[2]).text().trim();
    if (name && time) {
      entries.push({ name, time });
    }
  });

  if (entries.length < 3) return null;

  // Event display name
  const prettyEvent = `Ranking of 2025 ${eventSlug.split("-")[2]} HYROX ${
    genderLabel
  }`;

  return [
    `${prettyEvent}${group}`,
    prettyEvent,
    eventSlug.split("-")[2].charAt(0).toUpperCase() +
      eventSlug.split("-")[2].slice(1),
    "2025",
    group,
    genderLabel,
    entries[0].name,
    entries[0].time,
    entries[1].name,
    entries[1].time,
    entries[2].name,
    entries[2].time,
  ];
}

// Main updater
async function updateAllMasters() {
  const listRes = await fetch(EVENTS_FILE);
  const text = await listRes.text();
  const slugs = [...new Set(text.trim().split(/\s+/))]; // dedupe

  const results = [];

  for (const slug of slugs) {
    for (const gender of GENDERS) {
      for (const group of MASTER_GROUPS) {
        const url = `https://www.hyresult.com/ranking/${slug}-${gender.slug}?ag=${group}`;
        const data = await scrapePodium(url, slug, group, gender.label);
        if (data) {
          results.push(data);
        } else {
          results.push([
            `No podium available for ${slug}-${gender.slug}?ag=${group}`,
            `${slug}-${gender.slug}?ag=${group}`,
            "",
            "",
            group,
            gender.label,
            "",
            "",
            "",
            "",
            "",
            "",
          ]);
        }
      }
    }
  }

  const payload = { rows: results, last_run: new Date().toISOString() };
  saveCache(payload);
  return payload;
}

// API Routes
app.get("/api/update-masters", async (req, res) => {
  try {
    const data = await updateAllMasters();
    res.json({ ok: true, updated: data.rows.length });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get("/api/masters", (req, res) => {
  const cache = loadCache();
  res.json({
    total_rows: cache.rows.length,
    rows: cache.rows,
    columns: [
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
    ],
    last_run: cache.last_run,
  });
});

app.get("/api/health", (req, res) => res.send("OK"));

app.listen(PORT, "0.0.0.0", () =>
  console.log(`✅ HYROX Masters scraper running on ${PORT}`)
);
