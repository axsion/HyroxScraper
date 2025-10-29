/**
 * HYROX Scraper v25 — Masters-Complete Edition
 * ---------------------------------------------
 * ✅ Crawls S7–S9 (2025–2026)
 * ✅ Focused on Masters age groups (45–79 + legacy 50–59, 60–69)
 * ✅ Solo + Doubles (Men/Women/Mixed)
 * ✅ Smart duplicate prevention (per event+category)
 * ✅ Auto-installs Chromium on Render free tier
 */

import express from "express";
import { chromium } from "playwright";
import { execSync } from "child_process";
import fs from "fs";
import path from "path";

const app = express();
const PORT = process.env.PORT || 10000;

/* -----------------------------------------------------------
   🧩 Auto-Install Chromium (Render-safe)
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
   💾 Persistent Cache Setup
----------------------------------------------------------- */
const DATA_DIR = path.join(process.cwd(), "data");
const LAST_RUN_FILE = path.join(DATA_DIR, "last-run.json");
if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });

let cache = { events: [] };
if (fs.existsSync(LAST_RUN_FILE)) {
  cache = JSON.parse(fs.readFileSync(LAST_RUN_FILE, "utf8"));
  console.log(`✅ Loaded ${cache.events.length} cached events.`);
} else {
  console.log("ℹ️ No cache found — starting fresh.");
}

/* -----------------------------------------------------------
   🧠 Utilities
----------------------------------------------------------- */
function looksLikeTime(s) {
  return /^\d{1,2}:\d{2}(:\d{2})?$/.test(s);
}

/* -----------------------------------------------------------
   🕷️ Scraper
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
    await page.waitForTimeout(1200);

    const rows = await page.evaluate(() => {
      const table = document.querySelector("table");
      if (!table) return [];

      const ths = Array.from(table.querySelectorAll("thead th")).map(th =>
        th.innerText.trim().toLowerCase()
      );
      const colIndex = names => ths.findIndex(h => names.some(n => h.includes(n)));

      const nameIdx = colIndex(["athlete", "name", "team", "pair", "competitor"]);
      const timeIdx = colIndex(["time", "result", "finish"]);

      return Array.from(table.querySelectorAll("tbody tr"))
        .slice(0, 3)
        .map(tr => {
          const tds = Array.from(tr.querySelectorAll("td"));
          const text = td => td?.innerText.replace(/\s+/g, " ").trim() || "";
          const name =
            nameIdx >= 0
              ? text(tds[nameIdx])
              : tds.map(text).find(v => /[A-Za-z]/.test(v) && !/^\d{1,2}:\d{2}/.test(v)) || "";
          const time =
            timeIdx >= 0
              ? text(tds[timeIdx])
              : tds.map(text).find(v => /^\d{1,2}:\d{2}/.test(v)) || "";
          const rank = tds.map(text).find(v => /^\d+$/.test(v)) || "";
          return { rank, name, time };
        })
        .filter(r => r.name && r.time);
    });

    await browser.close();
    return rows;
  } catch (err) {
    console.error(`❌ ${url}: ${err.message}`);
    await browser.close();
    return [];
  }
}

/* -----------------------------------------------------------
   🌍 URL Builders (Masters only)
----------------------------------------------------------- */
const MASTERS_AGE_GROUPS = [
  "45-49", "50-54", "55-59", "60-64",
  "65-69", "70-74", "75-79",
  "50-59", "60-69" // legacy S7
];

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

  const urls = [];
  for (const s of seasons)
    for (const y of years)
      for (const city of cities)
        for (const div of divisions)
          for (const ag of MASTERS_AGE_GROUPS)
            urls.push(`https://www.hyresult.com/ranking/${s}-${y}-${city}-${div}?ag=${ag}`);

  return [...new Set(urls)];
}

function buildWeekendUrls() {
  const baseUrls = [
    "https://www.hyresult.com/ranking/s8-2025-paris-hyrox-men",
    "https://www.hyresult.com/ranking/s8-2025-paris-hyrox-women",
    "https://www.hyresult.com/ranking/s8-2025-birmingham-hyrox-men",
    "https://www.hyresult.com/ranking/s8-2025-birmingham-hyrox-women",
    "https://www.hyresult.com/ranking/s8-2025-paris-hyrox-doubles-men",
    "https://www.hyresult.com/ranking/s8-2025-paris-hyrox-doubles-women",
    "https://www.hyresult.com/ranking/s8-2025-paris-hyrox-doubles-mixed",
    "https://www.hyresult.com/ranking/s8-2025-birmingham-hyrox-doubles-men",
    "https://www.hyresult.com/ranking/s8-2025-birmingham-hyrox-doubles-women",
    "https://www.hyresult.com/ranking/s8-2025-birmingham-hyrox-doubles-mixed",
  ];
  const urls = [];
  baseUrls.forEach(base =>
    MASTERS_AGE_GROUPS.forEach(ag => urls.push(`${base}?ag=${ag}`))
  );
  return urls;
}

/* -----------------------------------------------------------
   ⚙️ Scrape Controller
----------------------------------------------------------- */
async function runFullScrape(urlList) {
  const urls = urlList || buildAllUrls();
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
    const year = yearMatch ? parseInt(yearMatch[1]) : 2025;

    const eventName = `Ranking of ${year} ${city} HYROX ${type.toUpperCase()} ${gender}`;
    const key = `${eventName}_${category}`;

    if (cache.events.some(e => `${e.eventName}_${e.category}` === key)) {
      console.log(`⏩ Skipped cached ${key}`);
      continue;
    }

    const event = { eventName, city, year, category, gender, type, podium: rows, url };
    cache.events.push(event);
    newEvents.push(event);

    fs.writeFileSync(LAST_RUN_FILE, JSON.stringify(cache, null, 2));
    console.log(`✅ Added ${eventName} (${category})`);
  }

  console.log(`🎯 Completed scrape — ${newEvents.length} new events added.`);
  return newEvents;
}

/* -----------------------------------------------------------
   🌐 API Routes
----------------------------------------------------------- */
app.get("/", (_req, res) =>
  res.send("✅ HYROX Scraper v25 — Masters-Complete Edition (S7–S9, Solo & Doubles)")
);

app.get("/api/scrape-all", async (_req, res) => {
  try {
    const results = await runFullScrape();
    res.json({ added: results.length, events: results });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get("/api/scrape-weekend", async (_req, res) => {
  try {
    const results = await runFullScrape(buildWeekendUrls());
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

app.post("/api/set-initial-cache", express.json(), (req, res) => {
  const { events } = req.body;
  if (!Array.isArray(events))
    return res.status(400).json({ error: "Invalid cache payload" });
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
   🚀 Launch
----------------------------------------------------------- */
app.listen(PORT, () => console.log(`🔥 HYROX Scraper v25 running on port ${PORT}`));
