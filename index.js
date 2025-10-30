/**
 * HYROX Scraper v30.2 — GitHub events.txt + Render Self-Healing Edition
 * ---------------------------------------------------------------------
 * ✅ Auto-installs Chromium if missing (Render-safe)
 * ✅ Reads event URLs dynamically from a GitHub events.txt file
 * ✅ Crawls SOLO + DOUBLES (Men/Women/Mixed) for Masters categories
 * ✅ Persists cache in /data/last-run.json
 * ✅ Fully compatible with your Google Sheets integration
 */

import express from "express";
import { chromium } from "playwright";
import fetch from "node-fetch";
import { execSync } from "child_process";
import fs from "fs";
import path from "path";

/* -----------------------------------------------------------
   🧱 Ensure Chromium Runtime (Render-safe)
----------------------------------------------------------- */
try {
  const PLAYWRIGHT_DIR = "/opt/render/project/.playwright";
  if (!fs.existsSync(`${PLAYWRIGHT_DIR}/chromium`)) {
    console.log("🧩 Installing Chromium runtime (Render-safe)...");
    execSync("npx playwright install chromium", { stdio: "inherit" });
  } else {
    console.log("✅ Chromium already installed.");
  }
} catch (err) {
  console.warn("⚠️ Skipping Chromium install:", err.message);
}

/* -----------------------------------------------------------
   ⚙️ App Setup
----------------------------------------------------------- */
const app = express();
const PORT = process.env.PORT || 1000;
app.use(express.json({ limit: "10mb" }));

/* -----------------------------------------------------------
   💾 Cache Setup
----------------------------------------------------------- */
const DATA_DIR = path.join(process.cwd(), "data");
const CACHE_FILE = path.join(DATA_DIR, "last-run.json");
if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });

let cache = { events: [] };
if (fs.existsSync(CACHE_FILE)) {
  try {
    cache = JSON.parse(fs.readFileSync(CACHE_FILE, "utf8"));
    console.log(`✅ Loaded ${cache.events.length} cached events`);
  } catch {
    cache = { events: [] };
  }
}

/* -----------------------------------------------------------
   🌍 Load event URLs from GitHub
----------------------------------------------------------- */
const EVENTS_TXT_URL =
  "https://raw.githubusercontent.com/axsion/HyroxScraper/main/events.txt"; // ⬅️ replace with your real path

async function fetchEventList() {
  try {
    const res = await fetch(EVENTS_TXT_URL);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const text = await res.text();
    const urls = text
      .split(/\r?\n/)
      .map(l => l.trim())
      .filter(l => l && !l.startsWith("#"));
    const slugs = urls
      .map(u => {
        const match = u.match(/(s\d{1,2}-\d{4}-[a-z-]+-hyrox)/i);
        return match ? match[1] : null;
      })
      .filter(Boolean);
    console.log(`📄 Loaded ${slugs.length} event slugs from GitHub`);
    return slugs;
  } catch (err) {
    console.error(`⚠️ Could not fetch events.txt: ${err.message}`);
    return [];
  }
}

/* -----------------------------------------------------------
   🎯 Constants
----------------------------------------------------------- */
const MASTER_AGS = [
  "45-49", "50-54", "55-59", "60-64", "65-69", "70-74", "75-79",
  "50-59", "60-69"
];
const CATEGORIES = [
  { type: "solo", genders: ["men", "women"] },
  { type: "doubles", genders: ["men", "women", "mixed"] },
];

/* -----------------------------------------------------------
   🧠 Helpers
----------------------------------------------------------- */
function makeRankingURL(slug, type, gender, ag) {
  const base = slug.replace(/-hyrox$/, "");
  const tail =
    type === "doubles"
      ? `-hyrox-doubles-${gender}`
      : `-hyrox-${gender}`;
  return `https://www.hyresult.com/ranking/${base}-${tail}?ag=${ag}`;
}

function deriveMetaFromSlug(slug, type, gender, ag) {
  const cityMatch = slug.match(/\d{4}-(.*)-hyrox/i);
  const city = cityMatch ? cityMatch[1].replace(/-/g, " ").toUpperCase() : "UNKNOWN";
  const yearMatch = slug.match(/s\d{1,2}-(\d{4})/i);
  const year = yearMatch ? yearMatch[1] : "2025";
  const typeLabel = type === "doubles" ? "DOUBLE" : "SOLO";
  const genderLabel = gender.toUpperCase();

  return {
    key: `${slug}_${ag}_${type}_${gender}`,
    eventName: `Ranking of ${year} ${city} HYROX ${typeLabel} ${genderLabel}`,
    city,
    year,
    category: ag,
    gender: genderLabel === "MIXED" ? "Mixed" : genderLabel === "MEN" ? "Men" : "Women",
    type: type === "doubles" ? "Double" : "Solo",
  };
}

/* -----------------------------------------------------------
   🕷️ Scrape Podium
----------------------------------------------------------- */
async function scrapePodium(url) {
  console.log(`🔎 ${url}`);
  const browser = await chromium.launch({
    headless: true,
    args: ["--no-sandbox", "--disable-dev-shm-usage"]
  });
  const page = await browser.newPage();

  try {
    await page.goto(url, { waitUntil: "networkidle", timeout: 70000 });
    await page.waitForTimeout(1500);
    const rows = await page.$$eval("table tbody tr", trs =>
      trs.slice(0, 3).map(tr => {
        const tds = Array.from(tr.querySelectorAll("td")).map(td => td.innerText.trim());
        const name = tds.find(t => /[A-Za-z]/.test(t)) || "";
        const time = tds.find(t => /^\d{1,2}:\d{2}(:\d{2})?$/.test(t)) || "";
        return { name, time };
      })
    );
    await browser.close();
    if (!rows.length || !rows[0].time) {
      console.warn(`⚠️ No podium found for ${url}`);
      return null;
    }
    return rows;
  } catch (err) {
    console.error(`❌ Failed ${url}: ${err.message}`);
    await browser.close();
    return null;
  }
}

/* -----------------------------------------------------------
   🚀 Crawl Engine
----------------------------------------------------------- */
async function crawlFromSlugs(slugs) {
  const added = [];

  for (const slug of slugs) {
    for (const { type, genders } of CATEGORIES) {
      for (const gender of genders) {
        for (const ag of MASTER_AGS) {
          const url = makeRankingURL(slug, type, gender, ag);
          const meta = deriveMetaFromSlug(slug, type, gender, ag);

          if (cache.events.some(e => e.key === meta.key)) continue;

          const podium = await scrapePodium(url);
          if (!podium) continue;

          const event = { ...meta, podium, url };
          cache.events.push(event);
          added.push(event);
          fs.writeFileSync(CACHE_FILE, JSON.stringify(cache, null, 2));
          console.log(`✅ Added ${meta.eventName} (${ag})`);
        }
      }
    }
  }

  console.log(`🎯 Crawl complete — ${added.length} new events`);
  return added;
}

/* -----------------------------------------------------------
   🌐 API Endpoints
----------------------------------------------------------- */
app.get("/", (_req, res) =>
  res.send("✅ HYROX Scraper v30.2 — Render Self-Healing Edition")
);

app.get("/api/scrape-all", async (_req, res) => {
  try {
    const slugs = await fetchEventList();
    if (!slugs.length) return res.json({ added: 0, note: "No slugs found" });
    const results = await crawlFromSlugs(slugs);
    res.json({ added: results.length, totalCache: cache.events.length });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get("/api/scrape-weekend", async (_req, res) => {
  try {
    const slugs = await fetchEventList();
    const recent = slugs.slice(-2);
    const results = await crawlFromSlugs(recent);
    res.json({ added: results.length, totalCache: cache.events.length });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get("/api/last-run", (_req, res) => {
  if (!fs.existsSync(CACHE_FILE))
    return res.status(404).json({ error: "No cache found" });
  res.sendFile(CACHE_FILE);
});

app.get("/api/clear-cache", (_req, res) => {
  if (fs.existsSync(CACHE_FILE)) fs.unlinkSync(CACHE_FILE);
  cache = { events: [] };
  res.json({ status: "Cache cleared" });
});

app.post("/api/set-initial-cache", (req, res) => {
  const { events } = req.body;
  if (!Array.isArray(events))
    return res.status(400).json({ error: "Invalid payload" });
  cache.events = events;
  fs.writeFileSync(CACHE_FILE, JSON.stringify(cache, null, 2));
  res.json({ status: "✅ Cache restored", count: events.length });
});

/* -----------------------------------------------------------
   🏁 Start Server
----------------------------------------------------------- */
app.listen(PORT, () => {
  console.log(`🔥 HYROX Scraper v30.2 running on port ${PORT}`);
});
