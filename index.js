/**
 * HYROX Scraper v33.0 — Stable Production Build
 * ------------------------------------------------------------
 * ✅ Uses playwright-chromium (Chromium bundled inside package)
 * ✅ Reads events.txt dynamically from GitHub
 * ✅ Expands to SOLO + DOUBLE × MEN/WOMEN/MIXED × 45–79
 * ✅ Includes /api/check-events and /api/scrape-all routes
 * ✅ Writes all podiums to cache.json
 */

import express from "express";
import fetch from "node-fetch";
import fs from "fs";
import { chromium } from "playwright-chromium";

const app = express();
const PORT = process.env.PORT || 1000;
const CACHE_FILE = "cache.json";

// -----------------------------------------------------------------------------
// 🧩 Load event list from GitHub
// -----------------------------------------------------------------------------
async function fetchEventList() {
  const res = await fetch(
    "https://raw.githubusercontent.com/axsion/HyroxScraper/main/events.txt"
  );
  if (!res.ok) throw new Error("Failed to load events.txt from GitHub");
  const txt = await res.text();
  return txt
    .split(/\r?\n/)
    .map((x) => x.trim())
    .filter((x) => x.startsWith("https://"));
}

// -----------------------------------------------------------------------------
// 🕷 Scrape logic for one base event (expands to all combos)
// -----------------------------------------------------------------------------
async function scrapeEvent(page, baseUrl, cache) {
  const year = baseUrl.match(/\d{4}/)?.[0] ?? "2025";
  const city =
    baseUrl
      .replace(/^https?:\/\/www\.hyresult\.com\/ranking\//, "")
      .split("-")
      .filter((p) => p && !/^\d{4}$/.test(p))
      .slice(-1)[0]
      ?.toUpperCase() || "UNKNOWN";

  const ageGroups = ["45-49", "50-54", "55-59", "60-64", "65-69", "70-74", "75-79"];
  const genders = ["men", "women", "mixed"];
  const divisions = [
    { label: "SOLO", prefix: "hyrox" },
    { label: "DOUBLE", prefix: "hyrox-doubles" },
  ];

  for (const div of divisions) {
    for (const gender of genders) {
      for (const ag of ageGroups) {
        const url = `${baseUrl}-${div.prefix}-${gender}?ag=${ag}`;
        console.log(`🔎 Visiting ${url}`);
        try {
          await page.goto(url, { waitUntil: "domcontentloaded", timeout: 60000 });
          await page.waitForSelector("table tbody tr", { timeout: 10000 });

          const rows = await page.$$eval("table tbody tr", (trs) =>
            trs.slice(0, 3).map((tr) => {
              const tds = [...tr.querySelectorAll("td")].map((td) =>
                td.innerText.trim()
              );
              const name = tds.find((t) => /[A-Za-z]/.test(t)) || "";
              const time =
                tds.find((t) => /^\d{1,2}:\d{2}(:\d{2})?$/.test(t)) || "";
              return { name, time };
            })
          );

          if (rows.length > 0) {
            cache.push({
              event: `Ranking of ${year} ${city} HYROX ${div.label} ${gender.toUpperCase()}`,
              city,
              year,
              category: ag,
              gender,
              type: div.label,
              podium: rows,
              url,
            });
            console.log(`✅ Added ${city} ${div.label} ${gender.toUpperCase()} (${ag})`);
          }
        } catch (err) {
          console.warn(`⚠️ Skipped ${url}: ${err.message}`);
        }
      }
    }
  }
}

// -----------------------------------------------------------------------------
// 🚀 Full scrape routine
// -----------------------------------------------------------------------------
async function runFullScrape() {
  const urls = await fetchEventList();
  console.log(`🌍 Loaded ${urls.length} base events from GitHub`);

  const cache = [];
  const browser = await chromium.launch({
    headless: true,
    args: ["--no-sandbox", "--disable-dev-shm-usage"],
  });
  const page = await browser.newPage();

  for (const base of urls) {
    await scrapeEvent(page, base, cache);
  }

  await browser.close();
  fs.writeFileSync(CACHE_FILE, JSON.stringify(cache, null, 2));
  return { added: cache.length, totalCache: cache.length };
}

// -----------------------------------------------------------------------------
// 🧭 Routes
// -----------------------------------------------------------------------------
app.get("/", (_req, res) => {
  res.send("✅ HYROX Scraper v33.0 is live — use /api/check-events or /api/scrape-all");
});

app.get("/api/check-events", async (_req, res) => {
  try {
    const urls = await fetchEventList();
    res.json({ valid: urls.length, sample: urls.slice(0, 10) });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get("/api/scrape-all", async (_req, res) => {
  try {
    const result = await runFullScrape();
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get("/api/last-run", (_req, res) => {
  if (fs.existsSync(CACHE_FILE)) {
    res.sendFile(`${process.cwd()}/${CACHE_FILE}`);
  } else {
    res.status(404).json({ error: "No cache found" });
  }
});

// -----------------------------------------------------------------------------
// 🏁 Start server
// -----------------------------------------------------------------------------
app.listen(PORT, () => {
  console.log(`🔥 HYROX Scraper v33.0 running on port ${PORT}`);
});
