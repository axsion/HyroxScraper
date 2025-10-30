/**
 * HYROX Scraper v28.5 — Stable Render Edition
 * --------------------------------------------
 * ✅ Crawls all past events from https://www.hyresult.com/events?tab=past
 * ✅ Supports SOLO + DOUBLES (Men, Women, Mixed)
 * ✅ Handles both S7 & S8 age groups
 * ✅ Writes persistent cache (/data/last-run.json)
 * ✅ Integrates with Google Sheets app script
 */

import express from "express";
import { chromium } from "playwright";
import fs from "fs";
import path from "path";

const app = express();
const PORT = process.env.PORT || 1000;

/* -----------------------------------------------------------
   💾 Cache Setup
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
function looksLikeName(s) {
  return /[A-Za-z]/.test(s) && !looksLikeTime(s) && !/^(\d+|DNF|DSQ)$/i.test(s);
}

// ──────────────────────────────────────────────
// Discover past event slugs (Resilient v28.6)
// ──────────────────────────────────────────────
async function discoverPastSlugs() {
  console.log("🌐 Discovering past events from /events?tab=past (resilient scan)...");
  const browser = await chromium.launch({
    headless: true,
    args: ["--no-sandbox", "--disable-dev-shm-usage"],
  });
  const page = await browser.newPage();

  try {
    await page.goto("https://www.hyresult.com/events?tab=past", {
      waitUntil: "domcontentloaded",
      timeout: 180000,
    });

    // Force client-side rendering by interacting
    await page.waitForTimeout(4000);
    await page.mouse.wheel(0, 3000);
    await page.waitForTimeout(3000);

    // Sometimes links load only after a scroll to bottom
    let prevHeight = 0;
    for (let i = 0; i < 25; i++) {
      const currentHeight = await page.evaluate(() => {
        window.scrollBy(0, 1000);
        return document.body.scrollHeight;
      });
      if (currentHeight === prevHeight) break;
      prevHeight = currentHeight;
      await page.waitForTimeout(2000);
    }

    // Try to detect event links, with retries
    let retries = 0;
    let slugs = [];
    while (slugs.length === 0 && retries < 3) {
      try {
        await page.waitForSelector("a[href*='/ranking/']", { timeout: 60000 });
        slugs = await page.$$eval("a[href*='/ranking/']", (links) => {
          const results = new Set();
          for (const a of links) {
            const href = a.getAttribute("href");
            if (!href) continue;
            const match = href.match(/\/ranking\/(s\d{1,2}-\d{4}-[a-z-]+)-hyrox/i);
            if (match) results.add(match[1]);
          }
          return Array.from(results);
        });
      } catch {
        retries++;
        console.log(`⚠️ Retry ${retries}/3 — waiting for event cards...`);
        await page.waitForTimeout(5000);
      }
    }

    if (!slugs.length) console.warn("⚠️ Still no slugs found after retries.");
    else console.log(`🌍 Found ${slugs.length} event slugs.`);

    await browser.close();
    return slugs;
  } catch (err) {
    console.error(`❌ Slug discovery failed: ${err.message}`);
    await browser.close();
    return [];
  }
}

/* -----------------------------------------------------------
   🕸️ Crawl Each Event (Solo + Double)
----------------------------------------------------------- */
async function scrapeEvent(url) {
  console.log(`🔎 ${url}`);
  const browser = await chromium.launch({
    headless: true,
    args: ["--no-sandbox", "--disable-dev-shm-usage"],
  });
  const page = await browser.newPage();

  try {
    await page.goto(url, { waitUntil: "networkidle", timeout: 60000 });
    await page.waitForTimeout(1500);

    const rows = await page.$$eval("table tbody tr", (trs) =>
      trs.slice(0, 3).map((tr) => {
        const tds = [...tr.querySelectorAll("td")].map((td) =>
          td.innerText.trim()
        );
        const name = tds.find((t) => /[A-Za-z]/.test(t) && t.length > 2) || "";
        const time = tds.find((t) => /^\d{1,2}:\d{2}(:\d{2})?$/.test(t)) || "";
        return { name, time };
      })
    );

    await browser.close();
    return rows;
  } catch (err) {
    console.error(`❌ Failed ${url}: ${err.message}`);
    await browser.close();
    return null;
  }
}

/* -----------------------------------------------------------
   ⚙️ Full Crawl Routine
----------------------------------------------------------- */
async function runFullScrape() {
  const slugs = await discoverPastSlugs();
  if (!slugs.length) {
    console.warn("⚠️ No slugs discovered — aborting.");
    return [];
  }

  const masterAgeGroups = [
    "45-49", "50-54", "55-59", "60-64", "65-69", "70-74", "75-79",
    "50-59", "60-69", // S7 legacy
  ];

  const categories = [
    { type: "solo", genders: ["men", "women"] },
    { type: "doubles", genders: ["men", "women", "mixed"] },
  ];

  const newEvents = [];

  for (const slug of slugs) {
    for (const { type, genders } of categories) {
      for (const gender of genders) {
        for (const ag of masterAgeGroups) {
          const url = `https://www.hyresult.com/ranking/${slug}-hyrox${type === "doubles" ? "-doubles" : ""
            }-${gender}?ag=${ag}`;

          const rows = await scrapeEvent(url);
          if (!rows || !rows.length) continue;

          const cityMatch = slug.match(/\d{4}-(.*)$/);
          const city = cityMatch ? cityMatch[1].replace(/-/g, " ").toUpperCase() : "UNKNOWN";
          const yearMatch = slug.match(/s\d{1,2}-(\d{4})/);
          const year = yearMatch ? yearMatch[1] : "2025";
          const eventName = `Ranking of ${year} ${city} HYROX ${type.toUpperCase()} ${gender.toUpperCase()}`;
          const category = ag;
          const key = `${slug}_${category}_${type}_${gender}`;

          if (cache.events.some((e) => e.key === key)) {
            console.log(`⏩ Skipped cached ${key}`);
            continue;
          }

          const event = {
            key,
            eventName,
            city,
            year,
            category,
            gender,
            type: type === "doubles" ? "Double" : "Solo",
            podium: rows,
            url,
          };

          cache.events.push(event);
          newEvents.push(event);
          fs.writeFileSync(LAST_RUN_FILE, JSON.stringify(cache, null, 2));
          console.log(`✅ Added ${eventName} (${category})`);
        }
      }
    }
  }

  console.log(`🎯 Completed scrape — ${newEvents.length} new events.`);
  return newEvents;
}

/* -----------------------------------------------------------
   🌐 API Endpoints
----------------------------------------------------------- */
app.get("/", (_req, res) =>
  res.send("✅ HYROX Scraper v28.5 — All past events via deep DOM crawler")
);

app.get("/api/scrape-all", async (_req, res) => {
  try {
    const results = await runFullScrape();
    res.json({ added: results.length, totalCache: cache.events.length });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get("/api/last-run", (_req, res) => {
  if (!fs.existsSync(LAST_RUN_FILE))
    return res.status(404).json({ error: "No cache found" });
  res.sendFile(LAST_RUN_FILE);
});

app.get("/api/clear-cache", (_req, res) => {
  if (fs.existsSync(LAST_RUN_FILE)) fs.unlinkSync(LAST_RUN_FILE);
  cache = { events: [] };
  res.json({ status: "Cache cleared" });
});

/* -----------------------------------------------------------
   🚀 Start server
----------------------------------------------------------- */
app.listen(PORT, () =>
  console.log(`🔥 HYROX Scraper v28.5 running on port ${PORT}`)
);
