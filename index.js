/**
 * HYROX Scraper v28.1 — Render-Safe, Full-Recrawl Edition
 * --------------------------------------------------------
 * ✅ Auto-discovers all past events from /events?tab=past
 * ✅ Crawls Solo + Doubles (Men/Women/Mixed) for Masters age groups
 * ✅ Handles s7 legacy AGs (50-59, 60-69)
 * ✅ Auto-installs Chromium in user space (no sudo)
 * ✅ Compatible with Google Sheets v28 integration (Solo-YYYY / Double-YYYY)
 */

import express from "express";
import fs from "fs";
import path from "path";
import { chromium } from "playwright";
import { execSync } from "child_process";

const app = express();
const PORT = process.env.PORT || 1000;

// ───────────────────────────────────────────────────────────
// Paths & Cache Setup
// ───────────────────────────────────────────────────────────
const DATA_DIR = path.join(process.cwd(), "data");
const LAST_RUN_FILE = path.join(DATA_DIR, "last-run.json");
if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });

let cache = { events: [] };
if (fs.existsSync(LAST_RUN_FILE)) {
  try {
    cache = JSON.parse(fs.readFileSync(LAST_RUN_FILE, "utf8"));
    console.log(`✅ Loaded ${cache.events.length} cached events.`);
  } catch (err) {
    console.warn("⚠️ Cache read error, starting fresh:", err.message);
    cache = { events: [] };
  }
} else {
  console.log("ℹ️ No cache found — starting fresh.");
}

app.use(express.json({ limit: "10mb" })); // prevent PayloadTooLargeError

// ───────────────────────────────────────────────────────────
// Ensure Chromium (Render-safe — no root required)
// ───────────────────────────────────────────────────────────
try {
  const PW_DIR = process.env.PLAYWRIGHT_BROWSERS_PATH || "/opt/render/project/.playwright";
  const chromiumPath = path.join(PW_DIR, "chromium");
  if (!fs.existsSync(chromiumPath)) {
    console.log("🧩 Installing user-space Chromium...");
    execSync("PLAYWRIGHT_BROWSERS_PATH=/opt/render/project/.playwright npx playwright install chromium", { stdio: "inherit" });
    console.log("✅ Chromium installed in user space.");
  } else {
    console.log("✅ Chromium already installed.");
  }
} catch (err) {
  console.warn("⚠️ Chromium install skipped:", err.message);
}

// ───────────────────────────────────────────────────────────
// Constants & Utilities
// ───────────────────────────────────────────────────────────
const MASTER_AGS_S8 = ["45-49","50-54","55-59","60-64","65-69","70-74","75-79"];
const MASTER_AGS_S7 = ["50-59","60-69"];

const normalize = s => (s || "").replace(/\s+/g, " ").trim();
const looksLikeTime = s => /^\d{1,2}:\d{2}(:\d{2})?$/.test(s);
const looksLikeName = s => /[A-Za-zÀ-ÿ]/.test(s) && !looksLikeTime(s) && !/^\d+$/.test(s);

function yearFromSlug(slug) {
  const m = slug.match(/s\d{1,2}-(\d{4})-/i);
  return m ? m[1] : "2025";
}

function cityFromSlug(slug) {
  const m = slug.match(/s\d{1,2}-\d{4}-([a-z-]+)-hyrox/i);
  return m ? m[1].replace(/-/g, " ").toUpperCase() : "UNKNOWN";
}

function saveCache() {
  fs.writeFileSync(LAST_RUN_FILE, JSON.stringify(cache, null, 2));
}

function addUniqueEvent(event) {
  const key = `${event.eventName}_${event.category}_${event.type}`;
  if (cache.events.some(e => `${e.eventName}_${e.category}_${e.type}` === key)) return false;
  cache.events.push(event);
  saveCache();
  return true;
}

// ───────────────────────────────────────────────────────────
// Build URL Lists
// ───────────────────────────────────────────────────────────
function ageGroupsForSlug(slug) {
  return /^s7-/.test(slug) ? [...MASTER_AGS_S8, ...MASTER_AGS_S7] : MASTER_AGS_S8;
}

function buildBaseUrlsForSlug(slug) {
  return [
    { url: `https://www.hyresult.com/ranking/${slug}-men`, type: "Solo", gender: "Men" },
    { url: `https://www.hyresult.com/ranking/${slug}-women`, type: "Solo", gender: "Women" },
    { url: `https://www.hyresult.com/ranking/${slug}-doubles-men`, type: "Double", gender: "Men" },
    { url: `https://www.hyresult.com/ranking/${slug}-doubles-women`, type: "Double", gender: "Women" },
    { url: `https://www.hyresult.com/ranking/${slug}-doubles-mixed`, type: "Double", gender: "Mixed" }
  ];
}

function buildUrlsForSlugs(slugs) {
  const urls = [];
  for (const slug of slugs) {
    const baseDefs = buildBaseUrlsForSlug(slug);
    const ags = ageGroupsForSlug(slug);
    for (const def of baseDefs) {
      for (const ag of ags) {
        urls.push({
          url: `${def.url}?ag=${encodeURIComponent(ag)}`,
          slug,
          type: def.type,
          gender: def.gender,
          ag
        });
      }
    }
  }
  return urls;
}

// ───────────────────────────────────────────────────────────
// Scraping Logic
// ───────────────────────────────────────────────────────────
async function scrapePodium(url, { type }) {
  const browser = await chromium.launch({
    headless: true,
    args: ["--no-sandbox", "--disable-dev-shm-usage"]
  });
  const page = await browser.newPage();

  try {
    await page.goto(url, { waitUntil: "networkidle", timeout: 60000 });
    await page.waitForTimeout(800);

    const rows = await page.$$eval("table tbody tr", trs => {
      const looksLikeTime = txt => /^\d{1,2}:\d{2}(:\d{2})?$/.test(txt);
      const isNameish = txt => /[A-Za-zÀ-ÿ]/.test(txt) && !looksLikeTime(txt) && !/^\d+$/.test(txt);

      return trs.slice(0, 3).map(tr => {
        const tds = Array.from(tr.querySelectorAll("td")).map(td => td.innerText.trim());
        const names = tds.filter(isNameish);
        const name = names.length >= 2 ? `${names[0]}, ${names[1]}` : (names[0] || "");
        const time = tds.find(looksLikeTime) || "";
        return { name, time };
      }).filter(r => r.name && r.time);
    });

    await browser.close();
    if (!rows.length) {
      console.warn(`⚠️ No podium found: ${url}`);
      return null;
    }
    return rows;
  } catch (err) {
    await browser.close();
    console.error(`❌ ${url}: ${err.message}`);
    return null;
  }
}

// ───────────────────────────────────────────────────────────
// Discover past event slugs dynamically
// ───────────────────────────────────────────────────────────
async function discoverPastSlugs() {
  console.log("🌐 Discovering past events...");
  const res = await fetch("https://www.hyresult.com/events?tab=past");
  const html = await res.text();

  const matches = [...html.matchAll(/\/ranking\/(s\d{1,2}-\d{4}-[a-z-]+)-hyrox/gi)];
  const slugs = [...new Set(matches.map(m => m[1]))];
  console.log(`🌍 Found ${slugs.length} event slugs`);
  return slugs;
}

// ───────────────────────────────────────────────────────────
// Scrape Driver
// ───────────────────────────────────────────────────────────
async function scrapeBatch(urlDefs) {
  let added = 0;
  for (const def of urlDefs) {
    const { url, slug, type, gender, ag } = def;
    console.log(`🔎 ${url}`);

    const podium = await scrapePodium(url, { type });
    if (!podium) continue;

    const city = cityFromSlug(slug);
    const year = yearFromSlug(slug);
    const eventName = `Ranking of ${year} ${city} HYROX ${type.toUpperCase()} ${gender.toUpperCase()}`;
    const event = {
      eventName,
      city,
      year,
      category: ag,
      gender,
      type,
      podium,
      url
    };

    if (addUniqueEvent(event)) {
      added++;
      console.log(`✅ Added ${eventName} (${ag})`);
    } else {
      console.log(`⏩ Skipped cached ${eventName} (${ag})`);
    }

    await new Promise(r => setTimeout(r, 200));
  }

  console.log(`🎯 Completed scrape — ${added} new events added.`);
  return added;
}

// ───────────────────────────────────────────────────────────
// Routes
// ───────────────────────────────────────────────────────────
app.get("/", (_req, res) => res.send("✅ HYROX Scraper v28.1 — Render-Safe Build"));

app.get("/api/health", (_req, res) => res.json({ ok: true }));

app.get("/api/last-run", (_req, res) => {
  if (!fs.existsSync(LAST_RUN_FILE)) return res.status(404).json({ error: "No cache found" });
  return res.sendFile(LAST_RUN_FILE);
});

app.get("/api/clear-cache", (_req, res) => {
  if (fs.existsSync(LAST_RUN_FILE)) fs.unlinkSync(LAST_RUN_FILE);
  cache = { events: [] };
  return res.json({ status: "cleared" });
});

app.post("/api/set-initial-cache", (req, res) => {
  const { events } = req.body;
  if (!events || !Array.isArray(events)) return res.status(400).json({ error: "Invalid payload" });
  cache.events = events;
  saveCache();
  return res.json({ status: "✅ Cache restored", count: events.length });
});

app.get("/api/scrape-all", async (_req, res) => {
  try {
    const slugs = await discoverPastSlugs();
    const urls = buildUrlsForSlugs(slugs);
    const added = await scrapeBatch(urls);
    res.json({ added, totalCache: cache.events.length });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get("/api/scrape-latest", async (_req, res) => {
  try {
    const slugs = await discoverPastSlugs();
    const latest = slugs.slice(-2); // last 2 events
    console.log(`🆕 Latest slugs: ${latest}`);
    const urls = buildUrlsForSlugs(latest);
    const added = await scrapeBatch(urls);
    res.json({ added, totalCache: cache.events.length });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ───────────────────────────────────────────────────────────
app.listen(PORT, () => console.log(`🔥 HYROX Scraper v28.1 running on port ${PORT}`));
