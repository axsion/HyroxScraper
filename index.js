/**
 * HYROX Scraper v22 — Stable Forever Edition
 * ------------------------------------------
 * ✅ Handles Solo + Doubles, Men/Women/Mixed
 * ✅ Supports Seasons 7–9 (2025–2026+)
 * ✅ Auto-installs Chromium (Render safe)
 * ✅ Skips duplicates, keeps cache cumulative
 * ✅ Gracefully handles bad/missing data
 */

import express from "express";
import { chromium } from "playwright";
import { execSync } from "child_process";
import fs from "fs";
import path from "path";

const app = express();
const PORT = process.env.PORT || 10000;
app.use(express.json({ limit: "10mb" }));

/* -----------------------------------------------------------
   🧩 Auto-install Chromium (Render-safe)
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
  console.warn("⚠️ Chromium install skipped:", err.message);
}

/* -----------------------------------------------------------
   💾 Cache setup
----------------------------------------------------------- */
const DATA_DIR = path.join(process.cwd(), "data");
const LAST_RUN_FILE = path.join(DATA_DIR, "last-run.json");
if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });

let cache = { events: [] };
if (fs.existsSync(LAST_RUN_FILE)) {
  try {
    cache = JSON.parse(fs.readFileSync(LAST_RUN_FILE, "utf8"));
    console.log(`✅ Loaded ${cache.events.length} cached events.`);
  } catch {
    console.warn("⚠️ Cache corrupted — starting empty.");
    cache = { events: [] };
  }
} else {
  console.log("ℹ️ No cache found — starting fresh.");
}

/* -----------------------------------------------------------
   🧠 Helpers
----------------------------------------------------------- */
const looksLikeTime = s => /^\d{1,2}:\d{2}(:\d{2})?$/.test(s);
const looksLikeName = s =>
  /[A-Za-z]/.test(s) && !looksLikeTime(s) && !/^(\d+|DNF|DSQ)$/i.test(s);

/* -----------------------------------------------------------
   🕷️ Scraper core
----------------------------------------------------------- */
async function scrapeSingle(url) {
  console.log(`🔎 ${url}`);
  const browser = await chromium.launch({
    headless: true,
    args: ["--no-sandbox", "--disable-dev-shm-usage"],
  });
  const page = await browser.newPage();

  try {
    await page.goto(url, { waitUntil: "networkidle", timeout: 60000 });
    await page.waitForTimeout(1500);

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
    return rows.filter(r => r.name && r.time);
  } catch (err) {
    console.error(`❌ ${url}: ${err.message}`);
    await browser.close();
    return [];
  }
}

/* -----------------------------------------------------------
   🌍 Dynamic URL builder (2025–2026 and beyond)
----------------------------------------------------------- */
function buildAllUrls() {
  const seasons = ["s7", "s8", "s9"];
  const years = [2025, 2026];
  const cities = [
    "valencia", "gdansk", "geneva", "hamburg", "paris", "birmingham",
    "toronto", "oslo", "rome", "boston", "sydney", "singapore",
    "new-york", "heerenveen", "madrid", "dubai"
  ];
  const divisions = [
    "hyrox-men", "hyrox-women",
    "hyrox-doubles-men", "hyrox-doubles-women", "hyrox-doubles-mixed"
  ];
  const ageGroups = [
    "16-24","25-29","30-34","35-39","40-44","45-49",
    "50-54","55-59","60-64","65-69","70-74","75-79",
    // Legacy S7
    "50-59","60-69"
  ];

  const urls = [];
  seasons.forEach(s =>
    years.forEach(y =>
      cities.forEach(city =>
        divisions.forEach(div =>
          ageGroups.forEach(ag => urls.push(`https://www.hyresult.com/ranking/${s}-${y}-${city}-${div}?ag=${ag}`))
        )
      )
    )
  );
  return urls;
}

/* -----------------------------------------------------------
   ⚙️ Scrape batch (skip cached)
----------------------------------------------------------- */
async function runFullScrape() {
  const urls = buildAllUrls();
  const newEvents = [];

  for (const url of urls) {
    const rows = await scrapeSingle(url);
    if (!rows.length) continue;

    const cityMatch = url.match(/202\d-(.*?)-hyrox/i);
    const city = cityMatch ? cityMatch[1].replace(/-/g, " ").toUpperCase() : "UNKNOWN";
    const genderMatch = url.match(/(men|women|mixed)/i);
    const gender = genderMatch ? genderMatch[1].toUpperCase() : "UNKNOWN";
    const type = url.includes("doubles") ? "Double" : "Solo";
    const agMatch = url.match(/\?ag=(\d{2}-\d{2})/);
    const category = agMatch ? agMatch[1] : "";
    const yearMatch = url.match(/(202\d)/);
    const year = yearMatch ? parseInt(yearMatch[1]) : 0;

    const eventName = `Ranking of ${year} ${city} HYROX ${type.toUpperCase()} ${gender}`;
    const key = `${eventName}_${category}`;
    if (cache.events.some(e => `${e.eventName}_${e.category}` === key)) {
      console.log(`⏩ Skipped cached ${key}`);
      continue;
    }

    const event = {
      eventName,
      city,
      year,
      category,
      gender,
      type,
      podium: rows,
      url
    };

    cache.events.push(event);
    newEvents.push(event);
    fs.writeFileSync(LAST_RUN_FILE, JSON.stringify(cache, null, 2));
    console.log(`✅ Added ${eventName} (${category})`);
  }

  console.log(`🎯 Completed ${newEvents.length} new events.`);
  return newEvents;
}

/* -----------------------------------------------------------
   🌐  API routes
----------------------------------------------------------- */
app.get("/", (_req, res) => res.send("✅ HYROX Scraper v22 — Stable Forever"));

app.get("/api/health", (_req, res) => res.json({ ok: true }));

app.get("/api/last-run", (_req, res) => {
  if (!fs.existsSync(LAST_RUN_FILE))
    return res.status(404).json({ error: "No cache" });
  res.sendFile(LAST_RUN_FILE);
});

app.get("/api/scrape-all", async (_req, res) => {
  try {
    const results = await runFullScrape();
    res.json({ added: results.length, events: results });
  } catch (err) {
    console.error("❌ Scrape error:", err);
    res.status(500).json({ error: err.message });
  }
});

app.get("/api/clear-cache", (_req, res) => {
  if (fs.existsSync(LAST_RUN_FILE)) fs.unlinkSync(LAST_RUN_FILE);
  cache = { events: [] };
  res.json({ status: "cleared" });
});

/**
 * 🧩 New robust endpoint — never throws 500 on bad input
 */
app.post("/api/set-initial-cache", (req, res) => {
  try {
    const { events } = req.body;
    if (!Array.isArray(events)) {
      return res.status(400).json({ error: "Invalid payload — expected { events: [] }" });
    }

    // Sanitize each event
    const cleaned = events
      .filter(e => e && typeof e === "object" && e.eventName)
      .map(e => ({
        eventName: e.eventName,
        city: e.city || "",
        year: Number(e.year) || 0,
        category: e.category || "",
        gender: e.gender || "",
        type: e.type || "",
        podium: Array.isArray(e.podium)
          ? e.podium
              .filter(p => p && p.name && p.time)
              .map(p => ({ name: p.name, time: p.time }))
          : [],
        url: e.url || ""
      }));

    cache.events = Array.isArray(cache.events)
      ? [...cache.events, ...cleaned]
      : cleaned;

    fs.writeFileSync(LAST_RUN_FILE, JSON.stringify(cache, null, 2));
    res.json({ status: "✅ Cache restored", count: cleaned.length });
  } catch (err) {
    console.error("❌ Cache restore error:", err.message);
    res.status(500).json({ error: "Server failed to restore cache" });
  }
});

/* -----------------------------------------------------------
   🚀 Start server
----------------------------------------------------------- */
app.listen(PORT, () => console.log(`🔥 HYROX Scraper v22 running on port ${PORT}`));
