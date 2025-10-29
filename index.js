/**
 * HYROX Universal Scraper v27.3
 * ------------------------------
 * ✅ Forces runtime Chromium install (Render-safe)
 * ✅ Auto-year, Solo & Doubles
 * ✅ Dynamic event discovery (2025–2026)
 * ✅ 10MB JSON limit for Google Sheets cache sync
 */

import express from "express";
import { chromium } from "playwright";
import { execSync } from "child_process";
import fs from "fs";
import path from "path";

const app = express();
const PORT = process.env.PORT || 10000;

/* -----------------------------------------------------------
   🧩 FORCE-INSTALL CHROMIUM EACH BOOT
----------------------------------------------------------- */
try {
  console.log("🧩 Ensuring Chromium runtime is installed...");
  execSync("npx playwright install --with-deps chromium", { stdio: "inherit" });
  console.log("✅ Chromium ready for use.");
} catch (err) {
  console.error("❌ Chromium install failed:", err.message);
}

/* -----------------------------------------------------------
   💾 Cache Setup
----------------------------------------------------------- */
const DATA_DIR = path.join(process.cwd(), "data");
const LAST_RUN_FILE = path.join(DATA_DIR, "last-run.json");
if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });

let cache = { events: [] };
if (fs.existsSync(LAST_RUN_FILE)) {
  try {
    cache = JSON.parse(fs.readFileSync(LAST_RUN_FILE, "utf8"));
    console.log(`✅ Loaded ${cache.events.length} cached events`);
  } catch {
    console.warn("⚠️ Cache load failed, starting fresh.");
  }
}

/* -----------------------------------------------------------
   🧠 Express Middleware (10MB Limit)
----------------------------------------------------------- */
app.use(express.json({ limit: "10mb" }));

/* -----------------------------------------------------------
   🧠 Constants & Helpers
----------------------------------------------------------- */
const AGE_GROUPS = [
  "45-49", "50-54", "55-59", "60-64", "65-69", "70-74", "75-79",
  "50-59", "60-69" // legacy S7
];

function looksLikeTime(t) {
  return /^\d{1,2}:\d{2}(:\d{2})?$/.test(t);
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
      console.warn(`⚠️ Could not fetch ${u}: ${err.message}`);
    }
  }

  // fallback in case hyresult is temporarily down
  slugs.add("s8-2025-paris-hyrox");
  slugs.add("s8-2025-birmingham-hyrox");

  console.log(`🌍 Found ${slugs.size} event slugs`);
  return [...slugs];
}

/* -----------------------------------------------------------
   🕷️ Scrape One URL
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
        const names = tds.filter(t => /[A-Za-z]/.test(t)).slice(0, 2).join(", ");
        const time = tds.find(t => /^\d{1,2}:\d{2}(:\d{2})?$/.test(t)) || "";
        return { name: names, time };
      })
    );

    await browser.close();
    return rows.length ? rows : null;
  } catch (err) {
    console.error(`❌ Error scraping ${url}: ${err.message}`);
    await browser.close();
    return null;
  }
}

/* -----------------------------------------------------------
   ⚙️ Scrape All Events Dynamically
----------------------------------------------------------- */
async function runDynamicScrape() {
  const slugs = await fetchEventSlugs();
  const newEvents = [];

  for (const slug of slugs) {
    const yearMatch = slug.match(/(\d{4})/);
    const year = yearMatch ? parseInt(yearMatch[1]) : new Date().getFullYear();
    const cityMatch = slug.match(/\d{4}-(.*?)-hyrox/i);
    const city = cityMatch ? cityMatch[1].replace(/-/g, " ").toUpperCase() : "UNKNOWN";

    const baseUrls = [
      { url: `https://www.hyresult.com/ranking/${slug}-men`, gender: "Men", type: "Solo" },
      { url: `https://www.hyresult.com/ranking/${slug}-women`, gender: "Women", type: "Solo" },
      { url: `https://www.hyresult.com/ranking/${slug}-doubles-men`, gender: "Men", type: "Double" },
      { url: `https://www.hyresult.com/ranking/${slug}-doubles-women`, gender: "Women", type: "Double" },
      { url: `https://www.hyresult.com/ranking/${slug}-doubles-mixed`, gender: "Mixed", type: "Double" }
    ];

    for (const { url: baseUrl, gender, type } of baseUrls) {
      for (const ag of AGE_GROUPS) {
        const fullUrl = `${baseUrl}?ag=${ag}`;
        const key = `${slug}_${ag}_${type}`;
        if (cache.events.some(e => e.key === key)) continue;

        const podium = await scrapeSingle(fullUrl);
        if (!podium) continue;

        const eventName = `Ranking of ${year} ${city} HYROX ${type.toUpperCase()} ${gender.toUpperCase()}`;
        const event = {
          key, eventName, city, year,
          category: ag, gender, type, podium, url: fullUrl
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
app.get("/", (_req, res) => res.send("✅ HYROX Scraper v27.3 — Render Finalized"));

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
  if (!fs.existsSync(LAST_RUN_FILE))
    return res.status(404).json({ error: "No cache found" });
  res.sendFile(LAST_RUN_FILE);
});

app.post("/api/set-initial-cache", (req, res) => {
  const { events } = req.body;
  if (!Array.isArray(events))
    return res.status(400).json({ error: "Invalid payload" });
  cache.events = events;
  fs.writeFileSync(LAST_RUN_FILE, JSON.stringify(cache, null, 2));
  res.json({ status: "✅ Cache restored", count: events.length });
});

app.get("/api/clear-cache", (_req, res) => {
  if (fs.existsSync(LAST_RUN_FILE)) fs.unlinkSync(LAST_RUN_FILE);
  cache = { events: [] };
  res.json({ status: "cleared" });
});

app.get("/api/health", (_req, res) => res.json({ ok: true }));

/* -----------------------------------------------------------
   🚀 Start Server
----------------------------------------------------------- */
app.listen(PORT, () => console.log(`🔥 HYROX Scraper v27.3 running on port ${PORT}`));
