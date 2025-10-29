/**
 * HYROX Universal Scraper v27.0
 * ------------------------------
 * ✅ Auto-year, Solo & Doubles
 * ✅ Dynamic event discovery
 * ✅ Render-safe with headless Chromium
 */

import express from "express";
import { chromium } from "playwright";
import { execSync } from "child_process";
import fs from "fs";
import path from "path";
//import fetch from "node-fetch";

const app = express();
const PORT = process.env.PORT || 10000;

/* -----------------------------------------------------------
   🧩 Auto-install Chromium (Render free tier)
----------------------------------------------------------- */
try {
  execSync("npx playwright install --with-deps chromium", { stdio: "inherit" });
} catch (err) {
  console.warn("⚠️ Playwright install skipped:", err.message);
}

/* -----------------------------------------------------------
   💾 Cache
----------------------------------------------------------- */
const DATA_DIR = path.join(process.cwd(), "data");
const LAST_RUN_FILE = path.join(DATA_DIR, "last-run.json");
if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });

let cache = { events: [] };
if (fs.existsSync(LAST_RUN_FILE)) {
  cache = JSON.parse(fs.readFileSync(LAST_RUN_FILE, "utf8"));
  console.log(`✅ Loaded ${cache.events.length} cached events`);
}

/* -----------------------------------------------------------
   🧠 Utilities
----------------------------------------------------------- */
const AGE_GROUPS = [
  "45-49", "50-54", "55-59", "60-64", "65-69", "70-74", "75-79",
  "50-59", "60-69" // legacy S7
];

function looksLikeTime(t) {
  return /^\d{1,2}:\d{2}(:\d{2})?$/.test(t);
}
function looksLikeName(t) {
  return /[A-Za-z]/.test(t) && !looksLikeTime(t) && !/^(\d+|DNF|DSQ)$/i.test(t);
}

/* -----------------------------------------------------------
   🌍 Dynamic Event Discovery
----------------------------------------------------------- */
async function fetchEventSlugs() {
  const urls = [
    "https://www.hyresult.com/events?tab=past",
    "https://www.hyresult.com/events?tab=upcoming"
  ];

  const slugs = new Set();
  for (const u of urls) {
    try {
      const res = await fetch(u);
      const html = await res.text();
      const matches = [...html.matchAll(/href="\/ranking\/(s\d{1,2}-\d{4}-[\w-]+-hyrox)/g)];
      matches.forEach(m => slugs.add(m[1]));
    } catch (err) {
      console.warn(`⚠️ Failed to fetch ${u}: ${err.message}`);
    }
  }

  // Manual fallbacks (for newly added events)
  slugs.add("s8-2025-paris-hyrox");
  slugs.add("s8-2025-birmingham-hyrox");

  console.log(`🌍 Discovered ${slugs.size} event slugs`);
  return [...slugs];
}

/* -----------------------------------------------------------
   🕷️ Scrape a Single URL
----------------------------------------------------------- */
async function scrapeSingle(url) {
  const browser = await chromium.launch({
    headless: true,
    args: ["--no-sandbox", "--disable-dev-shm-usage"]
  });
  const page = await browser.newPage();

  try {
    await page.goto(url, { waitUntil: "networkidle", timeout: 60000 });
    await page.waitForTimeout(1500);

    const rows = await page.$$eval("table tbody tr", trs =>
      trs.slice(0, 3).map(tr => {
        const tds = [...tr.querySelectorAll("td")].map(td => td.innerText.trim());
        const name = tds.filter(t => /[A-Za-z]/.test(t)).slice(0, 2).join(", ");
        const time = tds.find(t => /^\d{1,2}:\d{2}(:\d{2})?$/.test(t)) || "";
        return { name, time };
      })
    );

    await browser.close();
    return rows.length ? rows : null;
  } catch (err) {
    console.error(`❌ ${url}: ${err.message}`);
    await browser.close();
    return null;
  }
}

/* -----------------------------------------------------------
   ⚙️ Main Scrape Logic
----------------------------------------------------------- */
async function runDynamicScrape() {
  const slugs = await fetchEventSlugs();
  const newEvents = [];

  for (const slug of slugs) {
    const yearMatch = slug.match(/(\d{4})/);
    const year = yearMatch ? parseInt(yearMatch[1]) : new Date().getFullYear();
    const cityMatch = slug.match(/\d{4}-(.*?)-hyrox/i);
    const city = cityMatch ? cityMatch[1].replace(/-/g, " ").toUpperCase() : "UNKNOWN";

    const baseSoloMen = `https://www.hyresult.com/ranking/${slug}-men`;
    const baseSoloWomen = `https://www.hyresult.com/ranking/${slug}-women`;
    const baseDoubleMen = `https://www.hyresult.com/ranking/${slug}-doubles-men`;
    const baseDoubleWomen = `https://www.hyresult.com/ranking/${slug}-doubles-women`;
    const baseDoubleMixed = `https://www.hyresult.com/ranking/${slug}-doubles-mixed`;

    const allBases = [
      { url: baseSoloMen, gender: "Men", type: "Solo" },
      { url: baseSoloWomen, gender: "Women", type: "Solo" },
      { url: baseDoubleMen, gender: "Men", type: "Double" },
      { url: baseDoubleWomen, gender: "Women", type: "Double" },
      { url: baseDoubleMixed, gender: "Mixed", type: "Double" }
    ];

    for (const { url: baseUrl, gender, type } of allBases) {
      for (const ag of AGE_GROUPS) {
        const fullUrl = `${baseUrl}?ag=${ag}`;
        const key = `${slug}_${ag}_${type}`;
        if (cache.events.some(e => e.key === key)) continue;

        const podium = await scrapeSingle(fullUrl);
        if (!podium) continue;

        const eventName = `Ranking of ${year} ${city} HYROX ${type.toUpperCase()} ${gender.toUpperCase()}`;
        const event = {
          key,
          eventName,
          city,
          year,
          category: ag,
          gender,
          type,
          podium,
          url: fullUrl
        };

        cache.events.push(event);
        newEvents.push(event);
        fs.writeFileSync(LAST_RUN_FILE, JSON.stringify(cache, null, 2));
        console.log(`✅ Added ${eventName} (${ag})`);
      }
    }
  }

  console.log(`🎯 Completed scrape — ${newEvents.length} new events`);
  return newEvents;
}

/* -----------------------------------------------------------
   🌐 API Routes
----------------------------------------------------------- */
app.get("/", (_req, res) => res.send("✅ HYROX Scraper v27 — Auto-Year Edition"));

app.get("/api/scrape-latest", async (_req, res) => {
  try {
    const results = await runDynamicScrape();
    res.json({ added: results.length, events: results });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get("/api/scrape-weekend", async (_req, res) => {
  try {
    const results = await runDynamicScrape();
    res.json({ added: results.length, events: results });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get("/api/last-run", (_req, res) => {
  if (!fs.existsSync(LAST_RUN_FILE)) return res.status(404).json({ error: "No cache found" });
  res.sendFile(LAST_RUN_FILE);
});

app.post("/api/set-initial-cache", express.json(), (req, res) => {
  const { events } = req.body;
  if (!events) return res.status(400).json({ error: "Invalid cache payload" });
  cache.events = events;
  fs.writeFileSync(LAST_RUN_FILE, JSON.stringify(cache, null, 2));
  res.json({ status: "✅ Cache restored", count: events.length });
});

app.get("/api/clear-cache", (_req, res) => {
  if (fs.existsSync(LAST_RUN_FILE)) fs.unlinkSync(LAST_RUN_FILE);
  cache = { events: [] };
  res.json({ status: "cleared" });
});

/* -----------------------------------------------------------
   🚀 Start
----------------------------------------------------------- */
app.listen(PORT, () => console.log(`🔥 HYROX Scraper v27 running on port ${PORT}`));
