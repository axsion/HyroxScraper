/**
 * HYROX Masters Podium Scraper - Fly.io Version
 * ---------------------------------------------
 * Scrapes only Masters categories (45-49 to 70-74)
 * Caches results on disk at /data/masters.json
 * Endpoints:
 *   /api/health
 *   /api/update-masters   -> scrape & save
 *   /api/masters          -> return cached podiums
 */

import express from "express";
import fetch from "node-fetch";
import * as cheerio from "cheerio";
import fs from "fs";
import path from "path";

const app = express();
const PORT = process.env.PORT || 8080;

// Cache storage
const CACHE_FILE = "/data/masters.json";

// Masters age groups
const AGE_GROUPS = ["45-49", "50-54", "55-59", "60-64", "65-69", "70-74"];

// HYROX Event list source (same used in your Render version)
const EVENTS_URL =
  "https://raw.githubusercontent.com/axsion/HyroxScraper/main/events.txt";

/* --------------------------- Load Event List --------------------------- */
async function loadEvents() {
  try {
    const res = await fetch(EVENTS_URL);
    const text = await res.text();
    return text
      .split("\n")
      .map((l) => l.trim())
      .filter((l) => l.length > 0)
      .map((url) => {
        const match = url.match(/ranking\/(.*)$/);
        return match ? match[1].replace("/", "").trim() : null;
      })
      .filter(Boolean);
  } catch (err) {
    console.error("❌ Cannot load events list:", err);
    return [];
  }
}

/* --------------------------- Scrape One Podium Page --------------------------- */
async function scrapePodium(url, genderDisplay, city) {
  try {
    const res = await fetch(url);
    if (!res.ok) return null;
    const html = await res.text();
    const $ = cheerio.load(html);

    const placeRows = $(".place");
    if (placeRows.length < 3) return null;

    const gold = placeRows.eq(0).find(".name").text().trim();
    const silver = placeRows.eq(1).find(".name").text().trim();
    const bronze = placeRows.eq(2).find(".name").text().trim();

    const time1 = placeRows.eq(0).find(".time").text().trim();
    const time2 = placeRows.eq(1).find(".time").text().trim();
    const time3 = placeRows.eq(2).find(".time").text().trim();

    return { gold, silver, bronze, time1, time2, time3 };
  } catch {
    return null;
  }
}

/* --------------------------- Scrape One Event (Men + Women) --------------------------- */
async function scrapeEvent(eventSlug) {
  const menURL = `https://www.hyresult.com/ranking/${eventSlug}-hyrox-men`;
  const womenURL = `https://www.hyresult.com/ranking/${eventSlug}-hyrox-women`;

  const city = eventSlug.split("-")[2]?.toUpperCase() || "";

  let rows = [];

  async function handleGender(baseURL, genderLabel) {
    for (const age of AGE_GROUPS) {
      const url = `${baseURL}?ag=${age}`;
      const podium = await scrapePodium(url, genderLabel, city);

      if (!podium) {
        rows.push([
          `No podium available for ${eventSlug}-${genderLabel}?ag=${age}`,
          `${eventSlug}-${genderLabel}?ag=${age}`, "", "", age, genderLabel,
          "", "", "", "", "", ""
        ]);
      } else {
        const eventLabel = `Ranking of 2025 ${city} HYROX ${genderLabel}${age}`;
        rows.push([
          eventLabel,
          `Ranking of 2025 ${city} HYROX ${genderLabel}`,
          city,
          "2025",
          age,
          genderLabel,
          podium.gold,
          podium.time1,
          podium.silver,
          podium.time2,
          podium.bronze,
          podium.time3,
        ]);
      }
    }
  }

  await handleGender(menURL, "MEN");
  await handleGender(womenURL, "WOMEN");

  return rows;
}

/* --------------------------- Update Cache --------------------------- */
async function updateMasters() {
  const slugs = await loadEvents();
  let all = [];

  for (const slug of slugs) {
    console.log(`🔍 Scraping: ${slug}`);
    const rows = await scrapeEvent(slug);
    all.push(...rows);
  }

  const data = {
    columns: [
      "Event plus Cat", "Event", "City", "Date", "Category", "Gender",
      "Gold", "Time1", "Silver", "Time2", "Bronze", "Time3"
    ],
    rows: all,
    last_run: new Date().toISOString(),
  };

  fs.writeFileSync(CACHE_FILE, JSON.stringify(data, null, 2));
  console.log(`✅ Saved ${all.length} podium rows`);
  return data.rows.length;
}

/* --------------------------- API ENDPOINTS --------------------------- */
app.get("/api/health", (req, res) => {
  res.json({ ok: true });
});

app.get("/api/update-masters", async (req, res) => {
  const total = await updateMasters();
  res.json({ ok: true, updated: total });
});

app.get("/api/masters", (req, res) => {
  if (!fs.existsSync(CACHE_FILE)) {
    return res.json({
      total_rows: 0,
      rows: [],
      columns: [
        "Event plus Cat", "Event", "City", "Date", "Category", "Gender",
        "Gold", "Time1", "Silver", "Time2", "Bronze", "Time3"
      ],
      last_run: null,
    });
  }
  const data = JSON.parse(fs.readFileSync(CACHE_FILE, "utf8"));
  res.json({
    total_rows: data.rows.length,
    rows: data.rows,
    columns: data.columns,
    last_run: data.last_run,
  });
});

/* --------------------------- Start Server --------------------------- */
app.listen(PORT, "0.0.0.0", () =>
  console.log(`✅ HYROX Masters scraper running on port ${PORT}`)
);
