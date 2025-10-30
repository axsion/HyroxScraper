/**
 * HYROX Scraper v28.7 — Final Render Edition
 * --------------------------------------------
 * ✅ Discovers all /event/s* pages from https://www.hyresult.com/events?tab=past
 * ✅ Derives SOLO + DOUBLES (Men, Women, Mixed)
 * ✅ Crawls all Masters categories (45–79, +S7 50–59, 60–69)
 * ✅ Writes persistent cache
 * ✅ Works on Render Free Tier
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
   🕷️ Stage 1: Discover /event/ slugs from "past" page
----------------------------------------------------------- */
async function discoverEventPages() {
  console.log("🌐 Discovering event pages from /events?tab=past...");
  const browser = await chromium.launch({
    headless: true,
    args: ["--no-sandbox", "--disable-dev-shm-usage"],
  });
  const page = await browser.newPage();

  try {
    await page.goto("https://www.hyresult.com/events?tab=past", {
      waitUntil: "networkidle",
      timeout: 120000,
    });

    // scroll until fully loaded (React lazy load)
    let prevHeight = 0;
    while (true) {
      const currentHeight = await page.evaluate(() => {
        window.scrollBy(0, 1500);
        return document.body.scrollHeight;
      });
      if (currentHeight === prevHeight) break;
      prevHeight = currentHeight;
      await page.waitForTimeout(1800);
    }

    // extract /event/s* slugs
    const slugs = await page.$$eval("a[href*='/event/s']", (links) => {
      const results = new Set();
      for (const a of links) {
        const href = a.getAttribute("href");
        if (!href) continue;
        const match = href.match(/\/event\/(s\d{1,2}-\d{4}-[a-z-]+-hyrox)/i);
        if (match) results.add(match[1]);
      }
      return Array.from(results);
    });

    console.log(`🌍 Found ${slugs.length} /event/ pages.`);
    await browser.close();
    return slugs;
  } catch (err) {
    console.error(`❌ Event discovery failed: ${err.message}`);
    await browser.close();
    return [];
  }
}

/* -----------------------------------------------------------
   🕸️ Stage 2: Crawl ranking results per event
----------------------------------------------------------- */
async function scrapeEvent(url) {
  const browser = await chromium.launch({
    headless: true,
    args: ["--no-sandbox", "--disable-dev-shm-usage"],
  });
  const page = await browser.newPage();

  try {
    await page.goto(url, { waitUntil: "networkidle", timeout: 60000 });
    await page.waitForTimeout(1000);

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
  const slugs = await discoverEventPages();
  if (!slugs.length) {
    console.warn("⚠️ No event pages discovered — aborting.");
    return [];
  }

  const masterAG = [
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
        for (const ag of masterAG) {
          const url = `https://www.hyresult.com/ranking/${slug.replace("-hyrox", "")}-hyrox${type === "doubles" ? "-doubles" : ""}-${gender}?ag=${ag}`;

          const rows = await scrapeEvent(url);
          if (!rows || !rows.length) continue;

          const cityMatch = slug.match(/\d{4}-(.*)-hyrox/i);
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
  res.send("✅ HYROX Scraper v28.7 — Crawls /event/s* pages from past events")
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
  console.log(`🔥 HYROX Scraper v28.7 running on port ${PORT}`)
);
