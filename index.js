/**
 * HYROX Scraper v26 — Autonomous Dynamic Edition
 * ---------------------------------------------------------------
 * ✅ Automatically discovers new completed HYROX events
 * ✅ Crawls only Masters categories (45–79, + legacy 50–59, 60–69)
 * ✅ Covers both Solo and Doubles (Men / Women / Mixed)
 * ✅ Compatible with Google Sheets integration
 * ✅ Fully Render-safe (auto installs Chromium, caches in /data)
 */

import express from "express";
import fs from "fs";
import path from "path";
import { execSync } from "child_process";
import { chromium } from "playwright";

const app = express();
const PORT = process.env.PORT || 10000;

/* -----------------------------------------------------------
   🧱 1. Auto-install Chromium (Render Safe)
----------------------------------------------------------- */
try {
  const PLAYWRIGHT_DIR = "/opt/render/project/.playwright";
  if (!fs.existsSync(`${PLAYWRIGHT_DIR}/chromium`)) {
    console.log("🧩 Installing Chromium runtime...");
    execSync("npx playwright install chromium", { stdio: "inherit" });
  } else {
    console.log("✅ Chromium already installed.");
  }
} catch (err) {
  console.warn("⚠️ Skipping Chromium install:", err.message);
}

/* -----------------------------------------------------------
   💾 2. Cache Setup
----------------------------------------------------------- */
const DATA_DIR = path.join(process.cwd(), "data");
const LAST_RUN_FILE = path.join(DATA_DIR, "last-run.json");
const EVENTS_FILE = path.join(DATA_DIR, "events.json");
if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });

let cache = { events: [] };
if (fs.existsSync(LAST_RUN_FILE)) {
  cache = JSON.parse(fs.readFileSync(LAST_RUN_FILE, "utf8"));
  console.log(`✅ Loaded ${cache.events.length} cached events.`);
} else {
  console.log("ℹ️ No cache found — starting fresh.");
}

/* -----------------------------------------------------------
   🧠 3. Helpers
----------------------------------------------------------- */
const MASTER_AGE_GROUPS = [
  "45-49", "50-54", "55-59", "60-64", "65-69", "70-74", "75-79",
  "50-59", "60-69" // legacy S7
];

function delay(ms) {
  return new Promise(r => setTimeout(r, ms));
}

function looksLikeTime(s) {
  return /^\d{1,2}:\d{2}(:\d{2})?$/.test(s);
}

function looksLikeName(s) {
  return /[A-Za-z]/.test(s) && !looksLikeTime(s) && !/^(\d+|DNF|DSQ)$/i.test(s);
}

/* -----------------------------------------------------------
   🌍 4. Dynamic Event Discovery
----------------------------------------------------------- */
async function fetchEventSlugs() {
  console.log("🌐 Discovering events from HYROX /events?tab=past ...");
  const browser = await chromium.launch({
    headless: true,
    args: ["--no-sandbox", "--disable-dev-shm-usage"],
  });
  const page = await browser.newPage();

  await page.goto("https://www.hyresult.com/events?tab=past", {
    waitUntil: "networkidle",
    timeout: 60000,
  });

  // Extract event slugs from href attributes
  const slugs = await page.$$eval("a[href*='/ranking/']", links =>
    links
      .map(a => a.getAttribute("href"))
      .filter(Boolean)
      .filter(h => h.includes("/ranking/"))
      .map(h => h.split("/ranking/")[1].replace(/\/$/, ""))
  );

  await browser.close();

  const uniqueSlugs = [...new Set(slugs)];
  console.log(`📦 Found ${uniqueSlugs.length} past events.`);

  fs.writeFileSync(EVENTS_FILE, JSON.stringify(uniqueSlugs, null, 2));
  return uniqueSlugs;
}

/* -----------------------------------------------------------
   🕷️ 5. Scrape Single Podium
----------------------------------------------------------- */
async function scrapePodium(url) {
  console.log(`🔎 ${url}`);
  const browser = await chromium.launch({
    headless: true,
    args: ["--no-sandbox", "--disable-dev-shm-usage"],
    executablePath: process.env.PLAYWRIGHT_CHROMIUM_PATH || undefined,
  });
  const page = await browser.newPage();

  try {
    await page.goto(url, { waitUntil: "networkidle", timeout: 60000 });
    await page.waitForTimeout(1000);

    const rows = await page.$$eval("table tbody tr", trs =>
      trs.slice(0, 3).map(tr => {
        const tds = [...tr.querySelectorAll("td")].map(td => td.innerText.trim());
        const name = tds.find(t => /[A-Za-z]/.test(t) && t.length > 2) || "";
        const time = tds.find(t => /^\d{1,2}:\d{2}(:\d{2})?$/.test(t)) || "";
        const rank = tds.find(t => /^\d+$/.test(t)) || "";
        return { rank, name, time };
      })
    );

    await browser.close();

    if (!rows.length) {
      console.warn(`⚠️ No data for ${url}`);
      return null;
    }

    return rows;
  } catch (err) {
    console.error(`❌ Error scraping ${url}: ${err.message}`);
    await browser.close();
    return null;
  }
}

/* -----------------------------------------------------------
   🧩 6. Build URLs from event slugs
----------------------------------------------------------- */
function buildEventUrls(slugs) {
  const urls = [];
  const genderTags = ["men", "women"];
  const doubleTags = ["men", "women", "mixed"];

  slugs.forEach(slug => {
    // Solo
    genderTags.forEach(g =>
      MASTER_AGE_GROUPS.forEach(ag =>
        urls.push({ type: "Solo", url: `https://www.hyresult.com/ranking/${slug}-${g}?ag=${ag}` })
      )
    );

    // Doubles
    doubleTags.forEach(g =>
      MASTER_AGE_GROUPS.forEach(ag =>
        urls.push({ type: "Double", url: `https://www.hyresult.com/ranking/${slug}-doubles-${g}?ag=${ag}` })
      )
    );
  });

  return urls;
}

/* -----------------------------------------------------------
   ⚙️ 7. Crawl Batch (Dynamic)
----------------------------------------------------------- */
async function crawlDynamicEvents() {
  const slugs = await fetchEventSlugs();
  const urls = buildEventUrls(slugs);
  const newEvents = [];

  for (const { url, type } of urls) {
    const agMatch = url.match(/ag=(\d{2}-\d{2})/);
    const category = agMatch ? agMatch[1] : "";
    const cityMatch = url.match(/202\d-(.*?)-hyrox/i);
    const city = cityMatch ? cityMatch[1].replace(/-/g, " ").toUpperCase() : "UNKNOWN";
    const genderMatch = url.match(/(men|women|mixed)/i);
    const gender = genderMatch ? genderMatch[1].toUpperCase() : "UNKNOWN";
    const yearMatch = url.match(/(202\d{1})/);
    const year = yearMatch ? yearMatch[1] : "2025";
    const eventName = `Ranking of ${year} ${city} HYROX ${type.toUpperCase()} ${gender}`;
    const key = `${eventName}_${category}`;

    // Skip if already cached
    if (cache.events.some(e => `${e.eventName}_${e.category}` === key)) {
      console.log(`⏩ Skipped cached ${key}`);
      continue;
    }

    const podium = await scrapePodium(url);
    if (!podium) continue;

    const event = { eventName, city, year, category, gender, type, podium, url };
    cache.events.push(event);
    newEvents.push(event);
    fs.writeFileSync(LAST_RUN_FILE, JSON.stringify(cache, null, 2));

    console.log(`✅ Added ${eventName} (${category})`);
    await delay(600);
  }

  console.log(`🎯 Completed scrape — ${newEvents.length} new events added.`);
  return newEvents;
}

/* -----------------------------------------------------------
   🌐 8. API Routes
----------------------------------------------------------- */
app.get("/", (_req, res) => res.send("✅ HYROX Scraper v26 — Autonomous Masters Edition"));

app.get("/api/scrape-latest", async (_req, res) => {
  try {
    const results = await crawlDynamicEvents();
    res.json({ added: results.length, events: results });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
});

app.get("/api/last-run", (_req, res) => {
  if (!fs.existsSync(LAST_RUN_FILE)) return res.status(404).json({ error: "No cache found" });
  res.sendFile(LAST_RUN_FILE);
});

app.post("/api/set-initial-cache", express.json({ limit: "20mb" }), (req, res) => {
  const { events } = req.body;
  if (!events || !Array.isArray(events)) return res.status(400).json({ error: "Invalid cache payload" });
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
   🚀 9. Start Server
----------------------------------------------------------- */
app.listen(PORT, () => console.log(`🔥 HYROX Scraper v26 running on port ${PORT}`));
