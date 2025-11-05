/**
 * HYROX Masters Scraper v4.5
 * Fully static scraping (no Playwright), fast + Fly.io stable.
 */

import express from "express";
import fetch from "node-fetch";
import { load } from "cheerio"; // ✅ correct non-default import
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

// Paths
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const EVENTS_FILE = path.join(__dirname, "events.txt");
const CACHE_FILE = path.join(__dirname, "masters-cache.json");

// Age Groups
const AGE_GROUPS = ["45-49", "50-54", "55-59", "60-64", "65-69", "70-74"];

// Load events list
function loadEvents() {
  if (!fs.existsSync(EVENTS_FILE)) return [];
  return fs.readFileSync(EVENTS_FILE, "utf8")
    .split("\n")
    .map(x => x.trim())
    .filter(Boolean);
}

// Safe cache read/write
function saveCache(data) {
  fs.writeFileSync(CACHE_FILE, JSON.stringify(data, null, 2));
}
function loadCache() {
  return fs.existsSync(CACHE_FILE)
    ? JSON.parse(fs.readFileSync(CACHE_FILE, "utf8"))
    : { rows: [], updated: 0 };
}

// ---- PARSER ----
function parsePodium(html, slug, ageGroup, gender) {
  const $ = load(html);
  const rows = $("table tbody tr");

  // No table = no podium
  if (rows.length === 0) {
    return {
      "Event plus Cat": `No podium available for ${slug}?ag=${ageGroup}`,
      Event: slug,
      City: "",
      Date: "",
      Category: ageGroup,
      Gender: gender.toUpperCase(),
      Gold: "",
      Time1: "",
      Silver: "",
      Time2: "",
      Bronze: "",
      Time3: ""
    };
  }

  function extract(row) {
    const cols = $(row).find("td"); 
    return {
      athlete: $(cols[1]).text().trim(),
      time: $(cols[3]).text().trim()
    };
  }

  const gold = extract(rows[0]);
  const silver = rows[1] ? extract(rows[1]) : { athlete: "", time: "" };
  const bronze = rows[2] ? extract(rows[2]) : { athlete: "", time: "" };

  let city = slug.split("-").slice(3).join("-").replace(/-/g, " ");
  city = city.charAt(0).toUpperCase() + city.slice(1);

  return {
    "Event plus Cat": `Ranking of 2025 ${city} HYROX ${gender.toUpperCase()}${ageGroup}`,
    Event: `Ranking of 2025 ${city} HYROX ${gender.toUpperCase()}`,
    City: city,
    Date: "2025",
    Category: ageGroup,
    Gender: gender.toUpperCase(),
    Gold: gold.athlete,
    Time1: gold.time,
    Silver: silver.athlete,
    Time2: silver.time,
    Bronze: bronze.athlete,
    Time3: bronze.time
  };
}

// ---- SCRAPER ----
async function scrapeEvent(slug) {
  const genders = ["men", "women"];
  const results = [];

  for (const gender of genders) {
    for (const ag of AGE_GROUPS) {
      const url = `https://www.hyresult.com/ranking/${slug}-hyrox-${gender}?ag=${ag}`;
      try {
        const res = await fetch(url);
        const html = await res.text();
        results.push(parsePodium(html, slug, ag, gender));
      } catch (err) {
        console.log("ERROR fetching:", url);
      }
    }
  }

  return results;
}

// ---- EXPRESS ----
const app = express();
app.use(express.json());

// Update all events OR one slug
app.get("/api/update-masters", async (req, res) => {
  const events = loadEvents();
  if (events.length === 0) return res.json({ error: "No events in events.txt" });

  const requestedSlug = req.query.slug;
  const cache = loadCache();
  cache.rows = [];
  cache.updated = 0;

  for (const slug of events) {
    if (requestedSlug && slug !== requestedSlug) continue;
    const rows = await scrapeEvent(slug);
    cache.rows.push(...rows);
    cache.updated += rows.length;
  }

  saveCache(cache);
  res.json({ ok: true, updated: cache.updated, only_event: requestedSlug ?? null });
});

// Return cached results
app.get("/api/masters", (req, res) => {
  const cache = loadCache();
  res.json({
    total_rows: cache.rows.length,
    rows: cache.rows,
    columns: [
      "Event plus Cat", "Event", "City", "Date", "Category", "Gender",
      "Gold", "Time1", "Silver", "Time2", "Bronze", "Time3"
    ],
    last_run: cache.updated
  });
});

// Health check
app.get("/api/health", (req, res) => res.json({ ok: true }));

// Fly.io listen fix ✅
const PORT = process.env.PORT || 8080;
app.listen(PORT, "0.0.0.0", () => console.log(`✅ HYROX scraper running on ${PORT}`));
