/**
 * HYROX Scraper v30.3
 * - Reads events list dynamically from GitHub events.txt
 * - Crawls HYROX podiums for all master categories (45-49 → 75-79 + legacy)
 * - Includes a new diagnostic endpoint: /api/check-events
 */

import express from "express";
import fetch from "node-fetch";
import playwright from "playwright";
import fs from "fs";

const app = express();
app.use(express.json({ limit: "10mb" }));

// === CONFIGURATION ===
const PORT = process.env.PORT || 1000;
const EVENTS_FILE_URL =
  "https://raw.githubusercontent.com/axsion/HyroxScraper/main/events.txt";

const MASTER_CATEGORIES = [
  "45-49",
  "50-54",
  "55-59",
  "60-64",
  "65-69",
  "70-74",
  "75-79",
  "50-59",
  "60-69", // legacy S7
];

const GENDERS = ["men", "women"];
const DOUBLE_GENDERS = ["men", "women", "mixed"];
const TYPES = ["Solo", "Double"];

let cache = [];

// === HELPER: Fetch event slugs from GitHub ===
async function loadEventSlugs() {
  try {
    const res = await fetch(EVENTS_FILE_URL);
    if (!res.ok) throw new Error(`Failed to load events.txt: ${res.statusText}`);
    const text = await res.text();
    const lines = text
      .split(/\r?\n/)
      .map((l) => l.trim())
      .filter((l) => l.length > 0);

    const valid = lines.filter((l) => /^https:\/\/www\.hyresult\.com\/ranking\//.test(l));
    const invalid = lines.filter((l) => !/^https:\/\/www\.hyresult\.com\/ranking\//.test(l));

    console.log(`📄 Found ${valid.length} valid URLs, ${invalid.length} invalid`);
    if (invalid.length > 0) console.log("⚠️ Invalid lines:\n", invalid.join("\n"));

    return valid;
  } catch (err) {
    console.error("❌ Error fetching events.txt:", err.message);
    return [];
  }
}

// === HELPER: Scrape one event ===
async function scrapeEvent(browser, baseUrl) {
  const results = [];
  const city = baseUrl.split("/").pop().replace("s8-2025-", "").replace("s7-2025-", "").toUpperCase();
  const yearMatch = baseUrl.match(/s(\d+)-(\d{4})/);
  const year = yearMatch ? yearMatch[2] : "2025";

  const page = await browser.newPage();
  for (const type of TYPES) {
    const genderSet = type === "Solo" ? GENDERS : DOUBLE_GENDERS;
    for (const gender of genderSet) {
      for (const cat of MASTER_CATEGORIES) {
        const url = `${baseUrl}${type === "Double" ? "-doubles" : ""}-${gender}?ag=${cat}`;
        try {
          console.log(`🔎 ${url}`);
          await page.goto(url, { timeout: 60000, waitUntil: "domcontentloaded" });
          await page.waitForSelector("table", { timeout: 8000 });

          const podium = await page.$$eval("table tbody tr", (rows) =>
            rows.slice(0, 3).map((r) => {
              const cells = r.querySelectorAll("td");
              return {
                name: cells[1]?.innerText.trim(),
                time: cells[3]?.innerText.trim(),
              };
            })
          );

          if (podium.length > 0) {
            results.push({
              key: `${baseUrl}_${cat}_${type}`,
              eventName: `Ranking of ${year} ${city} HYROX ${type.toUpperCase()} ${gender.toUpperCase()}`,
              city,
              year,
              category: cat,
              gender: gender.charAt(0).toUpperCase() + gender.slice(1),
              type,
              podium,
              url,
            });
            console.log(`✅ Added ${city} ${type} ${gender.toUpperCase()} (${cat})`);
          }
        } catch {
          console.log(`⚠️ Skipped missing or invalid: ${url}`);
        }
      }
    }
  }
  await page.close();
  return results;
}

// === MAIN SCRAPER ===
async function runFullScrape() {
  const slugs = await loadEventSlugs();
  if (slugs.length === 0) {
    console.log("⚠️ No valid event URLs — aborting.");
    return [];
  }

  console.log(`🌍 Loaded ${slugs.length} event pages from GitHub`);
  const browser = await playwright.chromium.launch({ headless: true });
  const all = [];

  for (const slug of slugs) {
    const data = await scrapeEvent(browser, slug);
    all.push(...data);
  }

  await browser.close();
  cache = all;
  console.log(`🎯 Crawl complete — ${cache.length} podiums added`);
  return cache;
}

// === ROUTES ===

// Full scrape
app.get("/api/scrape-all", async (req, res) => {
  const data = await runFullScrape();
  res.json({ added: data.length, totalCache: cache.length });
});

// Last cached results
app.get("/api/last-run", (req, res) => {
  res.json(cache);
});

// Clear cache
app.get("/api/clear-cache", (req, res) => {
  cache = [];
  res.json({ status: "✅ Cache cleared" });
});

// Diagnostic endpoint
app.get("/api/check-events", async (req, res) => {
  try {
    const resTxt = await fetch(EVENTS_FILE_URL);
    const text = await resTxt.text();
    const lines = text
      .split(/\r?\n/)
      .map((l) => l.trim())
      .filter((l) => l.length > 0);

    const valid = lines.filter((l) => /^https:\/\/www\.hyresult\.com\/ranking\//.test(l));
    const invalid = lines.filter((l) => !/^https:\/\/www\.hyresult\.com\/ranking\//.test(l));

    res.json({
      source: EVENTS_FILE_URL,
      total: lines.length,
      valid: valid.length,
      invalid: invalid.length,
      validLines: valid,
      invalidLines: invalid,
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// === START SERVER ===
app.listen(PORT, () => {
  console.log(`🔥 HYROX Scraper v30.3 running on port ${PORT}`);
  console.log("✅ Diagnostic route enabled: /api/check-events");
});
