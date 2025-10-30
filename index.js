/**
 * HYROX Scraper v31.0 — Render-safe final version
 * -------------------------------------------------
 * ✅ Uses Playwright-core directly (no root install)
 * ✅ Reads events.txt dynamically from GitHub
 * ✅ Auto-detects S7 vs S8 age groups
 * ✅ Works on Render (Node 25)
 */

const express = require("express");
const fetch = require("node-fetch");
const playwright = require("playwright-core"); // ✅ Safe and stable core package

const app = express();
app.use(express.json({ limit: "10mb" }));

// === CONFIG ===
const PORT = process.env.PORT || 1000;
const EVENTS_FILE_URL =
  "https://raw.githubusercontent.com/axsion/HyroxScraper/main/events.txt";

const GENDERS = ["men", "women"];
const DOUBLE_GENDERS = ["men", "women", "mixed"];
const TYPES = ["Solo", "Double"];

// --- Season-specific age groups ---
const AG_S8 = ["45-49", "50-54", "55-59", "60-64", "65-69", "70-74", "75-79"];
const AG_S7 = ["50-59", "60-69"];
function ageGroupsFor(url) {
  return /\/s7-/.test(url) ? AG_S7 : AG_S8;
}

let cache = [];

/* -----------------------------------------------------------
   🔗 Load event URLs from GitHub
----------------------------------------------------------- */
async function loadEventSlugs() {
  try {
    const res = await fetch(EVENTS_FILE_URL);
    if (!res.ok) throw new Error(`Failed to fetch events.txt (${res.status})`);
    const text = await res.text();
    const lines = text.split(/\r?\n/).map(l => l.trim()).filter(Boolean);
    const valid = lines.filter(l =>
      /^https:\/\/www\.hyresult\.com\/ranking\//.test(l)
    );
    const invalid = lines.filter(l =>
      !/^https:\/\/www\.hyresult\.com\/ranking\//.test(l)
    );
    console.log(`📄 Found ${valid.length} valid URLs, ${invalid.length} invalid`);
    if (invalid.length) console.log("⚠️ Invalid lines:\n", invalid.join("\n"));
    return valid;
  } catch (err) {
    console.error("❌ Error loading events.txt:", err.message);
    return [];
  }
}

/* -----------------------------------------------------------
   🕷️ Scrape a single event page
----------------------------------------------------------- */
async function scrapeEvent(browser, baseUrl) {
  const results = [];
  const city = baseUrl.split("/").pop().replace(/s\d+-\d{4}-/, "").toUpperCase();
  const yearMatch = baseUrl.match(/s\d+-(\d{4})/);
  const year = yearMatch ? yearMatch[1] : "2025";
  const agList = ageGroupsFor(baseUrl);
  console.log(`🧭 AGs for ${baseUrl}: ${agList.join(", ")}`);

  const page = await browser.newPage();

  for (const type of TYPES) {
    const genderSet = type === "Solo" ? GENDERS : DOUBLE_GENDERS;
    for (const gender of genderSet) {
      for (const cat of agList) {
        const url = `${baseUrl}${type === "Double" ? "-doubles" : ""}-${gender}?ag=${cat}`;
        try {
          console.log(`🔎 Visiting ${url}`);
          await page.goto(url, { timeout: 60000, waitUntil: "domcontentloaded" });
          await page.waitForSelector("table", { timeout: 8000 });
          const podium = await page.$$eval("table tbody tr", rows =>
            rows.slice(0, 3).map(r => {
              const c = r.querySelectorAll("td");
              return {
                name: c[1]?.innerText.trim() || "",
                time: c[3]?.innerText.trim() || ""
              };
            })
          );
          if (podium.length) {
            const entry = {
              key: `${baseUrl}_${cat}_${type}_${gender}`,
              eventName: `Ranking of ${year} ${city} HYROX ${type.toUpperCase()} ${gender.toUpperCase()}`,
              city,
              year,
              category: cat,
              gender: gender[0].toUpperCase() + gender.slice(1),
              type,
              podium,
              url
            };
            results.push(entry);
            console.log(`✅ Added ${entry.eventName} (${cat})`);
          } else console.log(`⚠️ No podium found for ${url}`);
        } catch (err) {
          console.log(`⚠️ Skipped ${url}: ${err.message}`);
        }
      }
    }
  }

  await page.close();
  return results;
}

/* -----------------------------------------------------------
   🧠 Run full scrape
----------------------------------------------------------- */
async function runFullScrape() {
  const slugs = await loadEventSlugs();
  if (!slugs.length) {
    console.log("⚠️ No valid event URLs — aborting.");
    return [];
  }

  console.log(`🌍 Loaded ${slugs.length} events from GitHub`);
  const browser = await playwright.chromium.launch({ headless: true }); // ✅ Now stable
  console.log("✅ Using Playwright-core embedded Chromium");

  const all = [];
  for (const slug of slugs) {
    const data = await scrapeEvent(browser, slug);
    all.push(...data);
  }

  await browser.close();
  cache = all;
  console.log(`🎯 Crawl complete — ${cache.length} podiums cached`);
  return cache;
}

/* -----------------------------------------------------------
   🌐 Express API Routes
----------------------------------------------------------- */
app.get("/api/check-events", async (_req, res) => {
  try {
    const resTxt = await fetch(EVENTS_FILE_URL);
    const text = await resTxt.text();
    const lines = text.split(/\r?\n/).map(l => l.trim()).filter(Boolean);
    const valid = lines.filter(l =>
      /^https:\/\/www\.hyresult\.com\/ranking\//.test(l)
    );
    const invalid = lines.filter(l =>
      !/^https:\/\/www\.hyresult\.com\/ranking\//.test(l)
    );
    res.json({
      source: EVENTS_FILE_URL,
      total: lines.length,
      valid: valid.length,
      invalid: invalid.length,
      validLines: valid,
      invalidLines: invalid
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get("/api/scrape-all", async (_req, res) => {
  try {
    const data = await runFullScrape();
    res.json({ added: data.length, totalCache: cache.length });
  } catch (err) {
    console.error("❌ Scrape error:", err.message);
    res.status(500).json({ error: err.message });
  }
});

app.get("/api/clear-cache", (_req, res) => {
  cache = [];
  res.json({ status: "✅ Cache cleared" });
});

app.get("/api/last-run", (_req, res) => res.json(cache));
app.get("/api/health", (_req, res) => res.json({ ok: true }));

/* -----------------------------------------------------------
   🚀 Start server
----------------------------------------------------------- */
app.listen(PORT, () => {
  console.log(`🔥 HYROX Scraper v31.0 running on port ${PORT}`);
  console.log("✅ CommonJS mode (Render-safe)");
  console.log("✅ Using Playwright-core Chromium launcher");
  console.log("✅ Season-aware AG detection active (S7 vs S8)");
  console.log("✅ Diagnostic route: /api/check-events");
});
