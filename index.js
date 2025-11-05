import express from "express";
import fetch from "node-fetch";
import { load } from "cheerio";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const PORT = process.env.PORT || 8080;

// === File paths ===
const EVENTS_FILE = path.join(__dirname, "events.txt");
const CACHE_FILE = path.join(__dirname, "data", "masters-cache.json");
const LASTRUN_FILE = path.join(__dirname, "data", "last-run.json");

// Ensure /data exists
if (!fs.existsSync(path.join(__dirname, "data"))) {
  fs.mkdirSync(path.join(__dirname, "data"));
}

// === Load cache ===
let CACHE = [];
if (fs.existsSync(CACHE_FILE)) {
  try {
    CACHE = JSON.parse(fs.readFileSync(CACHE_FILE, "utf8"));
  } catch {
    CACHE = [];
  }
}

// === Masters parameters ===
const GENDERS = ["men", "women"];
const AGE_GROUPS = ["45-49", "50-54", "55-59", "60-64", "65-69", "70-74"];

// === Helpers ===
async function fetchHTML(url) {
  const res = await fetch(url);
  if (!res.ok) return null;
  return await res.text();
}

function parsePodium(html, slug, ageGroup, gender) {
  const $ = load(html);

  const rows = $("table tbody tr");
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
    const athlete = $(cols[1]).text().trim();
    const time = $(cols[3]).text().trim();
    return { athlete, time };
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

// === Crawl a single event slug ===
async function crawlEvent(slug) {
  let total = 0;

  for (const gender of GENDERS) {
    for (const ageGroup of AGE_GROUPS) {
      const url = `https://www.hyresult.com/ranking/${slug}-hyrox-${gender}?ag=${ageGroup}`;
      console.log("Fetching:", url);

      const html = await fetchHTML(url);
      const result = html
        ? parsePodium(html, slug, ageGroup, gender)
        : {
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

      // Remove previous data for this event+category
      CACHE = CACHE.filter(
        (r) =>
          !(r.Event === result.Event && r.Category === result.Category && r.Gender === result.Gender)
      );

      CACHE.push(result);
      total++;
    }
  }

  fs.writeFileSync(CACHE_FILE, JSON.stringify(CACHE, null, 2));
  return total;
}

// === Routes ===
app.get("/api/health", (req, res) => res.json({ ok: true }));

app.get("/api/masters", (req, res) => {
  const lastRun = fs.existsSync(LASTRUN_FILE)
    ? JSON.parse(fs.readFileSync(LASTRUN_FILE, "utf8"))
    : null;

  return res.json({
    total_rows: CACHE.length,
    rows: CACHE,
    columns: ["Event plus Cat", "Event", "City", "Date", "Category", "Gender", "Gold", "Time1", "Silver", "Time2", "Bronze", "Time3"],
    last_run: lastRun
  });
});

app.get("/api/update-masters", async (req, res) => {
  try {
    const events = fs.readFileSync(EVENTS_FILE, "utf8").trim().split("\n").filter(Boolean);
    const single = req.query.slug?.trim();

    const toProcess = single ? [single] : events;

    let updated = 0;
    for (const slug of toProcess) {
      updated += await crawlEvent(slug);
    }

    fs.writeFileSync(LASTRUN_FILE, JSON.stringify({ updated, at: new Date() }, null, 2));

    res.json({ ok: true, updated, only_event: single || null });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// === Start server ===
app.listen(PORT, "0.0.0.0", () =>
  console.log(`✅ HYROX Masters Scraper Running on 0.0.0.0:${PORT}`)
);
