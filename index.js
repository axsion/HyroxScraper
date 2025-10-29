/**
 * HYROX Universal Scraper v27.4
 * ----------------------------------
 * ✅ Works 100% on Render free tier
 * ✅ Auto-installs Chromium only if missing
 * ✅ No sudo / no --with-deps (Render-safe)
 * ✅ Auto-year + dynamic event discovery
 * ✅ 10 MB JSON body limit
 */

import express from "express";
import { chromium } from "playwright";
import { execSync } from "child_process";
import fs from "fs";
import path from "path";

const app = express();
const PORT = process.env.PORT || 10000;

/* -----------------------------------------------------------
   🧩 Ensure Chromium Exists (Render-safe)
----------------------------------------------------------- */
const PW_DIR = "/opt/render/project/.playwright";
try {
  const chromiumPath = path.join(PW_DIR, "chromium");
  if (!fs.existsSync(chromiumPath)) {
    console.log("🧩 Installing Chromium (Render-safe)...");
    execSync("npx playwright install chromium", { stdio: "inherit" });
    console.log("✅ Chromium installed successfully.");
  } else {
    console.log("✅ Chromium already present.");
  }
} catch (err) {
  console.warn("⚠️ Skipping Chromium install:", err.message);
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
    console.warn("⚠️ Failed to parse existing cache, starting fresh.");
  }
}

/* -----------------------------------------------------------
   🧠 Express Config
----------------------------------------------------------- */
app.use(express.json({ limit: "10mb" }));

const AGE_GROUPS = [
  "45-49", "50-54", "55-59", "60-64", "65-69", "70-74", "75-79",
  "50-59", "60-69"
];

/* -----------------------------------------------------------
   🌍 Discover Event Slugs
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
  if (slugs.size === 0) {
    slugs.add("s8-2025-paris-hyrox");
    slugs.add("s8-2025-birmingham-hyrox");
  }
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
    console.error(`❌ ${url}: ${err.message}`);
    await browser.close();
    return null;
  }
}

/* -----------------------------------------------------------
   ⚙️ Scrape All Events
----------------------------------------------------------- */
async function runDynamicScrape() {
  const slugs = await fetchEventSlugs();
  const newEvents = [];

  for (const slug of slugs) {
    const year = (slug.match(/(\d{4})/) || [])[1] || new Date().getFullYear();
    const city = (slug.match(/\d{4}-(.*?)-hyrox/i) || [])[1]?.replace(/-/g, " ").toUpperCase() || "UNKNOWN";

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
        const event = { key, eventName, city, year, category: ag, gender, type, podium, url: fullUrl };
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
   🌐 API
----------------------------------------------------------- */
app.get("/", (_req, res) => res.send("✅ HYROX Scraper v27.4 — Render Zero-Failure"));

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
   🚀 Start
----------------------------------------------------------- */
app.listen(PORT, () => console.log(`🔥 HYROX Scraper v27.4 running on port ${PORT}`));
