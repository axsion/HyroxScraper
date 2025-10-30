/**
 * HYROX Scraper v31.4 — Non-root Render-Stable
 * --------------------------------------------
 * ✅ Installs Chromium in user-space (no root)
 * ✅ Works on Render free-tier
 * ✅ Reads events.txt from GitHub
 * ✅ Supports both S7 and S8 age groups
 */

const express = require("express");
const fetch = require("node-fetch");
const { execSync } = require("child_process");
const path = require("path");
const fs = require("fs");

const app = express();
app.use(express.json({ limit: "10mb" }));

const PORT = process.env.PORT || 1000;
const EVENTS_FILE_URL =
  "https://raw.githubusercontent.com/axsion/HyroxScraper/main/events.txt";

const GENDERS = ["men", "women"];
const DOUBLE_GENDERS = ["men", "women", "mixed"];
const TYPES = ["Solo", "Double"];

const AG_S8 = ["45-49", "50-54", "55-59", "60-64", "65-69", "70-74", "75-79"];
const AG_S7 = ["50-59", "60-69"];

function ageGroupsFor(url) {
  return /\/s7-/.test(url) ? AG_S7 : AG_S8;
}

let chromium = null;
let cache = [];

/* -----------------------------------------------------------
   🧩 Ensure Chromium is installed (non-root)
----------------------------------------------------------- */
async function ensureChromiumInstalled() {
  try {
    const baseDir = path.join(process.cwd(), ".playwright");
    const chromePath = path.join(
      baseDir,
      "chromium-1124",
      "chrome-linux",
      "chrome"
    );

    if (!fs.existsSync(chromePath)) {
      console.log("🧩 Installing user-space Chromium (no root)...");
      execSync("npx playwright install chromium", { stdio: "inherit" });
      console.log("✅ Chromium installed successfully.");
    } else {
      console.log("✅ Chromium already installed.");
    }

    chromium = require("playwright-core").chromium;
  } catch (err) {
    console.error("❌ Failed to install Chromium:", err.message);
    throw err;
  }
}

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
    console.log(`📄 Found ${valid.length} valid URLs`);
    return valid;
  } catch (err) {
    console.error("❌ Error loading events.txt:", err.message);
    return [];
  }
}

/* -----------------------------------------------------------
   🕷️ Scrape a single event
----------------------------------------------------------- */
async function scrapeEvent(browser, baseUrl) {
  const results = [];
  const city = baseUrl.split("/").pop().replace(/s\d+-\d{4}-/, "").toUpperCase();
  const yearMatch = baseUrl.match(/s\d+-(\d{4})/);
  const year = yearMatch ? yearMatch[1] : "2025";
  const agList = ageGroupsFor(baseUrl);

  const page = await browser.newPage();
  for (const type of TYPES) {
    const genderSet = type === "Solo" ? GENDERS : DOUBLE_GENDERS;
    for (const gender of genderSet) {
      for (const cat of agList) {
        const url = `${baseUrl}${type === "Double" ? "-doubles" : ""}-${gender}?ag=${cat}`;
        try {
          console.log(`🔎 Visiting ${url}`);
          await page.goto(url, { waitUntil: "domcontentloaded", timeout: 60000 });
          await page.waitForSelector("table", { timeout: 8000 });
          const podium = await page.$$eval("table tbody tr", rows =>
            rows.slice(0, 3).map(r => {
              const c = r.querySelectorAll("td");
              return { name: c[1]?.innerText.trim() || "", time: c[3]?.innerText.trim() || "" };
            })
          );
          if (podium.length) {
            results.push({
              key: `${baseUrl}_${cat}_${type}_${gender}`,
              eventName: `Ranking of ${year} ${city} HYROX ${type.toUpperCase()} ${gender.toUpperCase()}`,
              city,
              year,
              category: cat,
              gender: gender[0].toUpperCase() + gender.slice(1),
              type,
              podium,
              url
            });
            console.log(`✅ Added ${city} ${type} ${gender} (${cat})`);
          }
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
   🧠 Run Full Scrape
----------------------------------------------------------- */
async function runFullScrape() {
  await ensureChromiumInstalled();
  const slugs = await loadEventSlugs();
  if (!slugs.length) return [];

  const browser = await chromium.launch({
    headless: true,
    args: ["--no-sandbox", "--disable-dev-shm-usage"]
  });

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
   🌐 Express API
----------------------------------------------------------- */
app.get("/api/check-events", async (_req, res) => {
  const resTxt = await fetch(EVENTS_FILE_URL);
  const text = await resTxt.text();
  const lines = text.split(/\r?\n/).map(l => l.trim()).filter(Boolean);
  res.json({ total: lines.length, lines });
});

app.get("/api/scrape-all", async (_req, res) => {
  try {
    const data = await runFullScrape();
    res.json({ added: data.length, totalCache: cache.length });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get("/api/health", (_req, res) => res.json({ ok: true }));

app.listen(PORT, () => {
  console.log(`🔥 HYROX Scraper v31.4 running on port ${PORT}`);
  console.log("✅ Non-root Playwright install");
  console.log("✅ Compatible with Render sandbox");
});
