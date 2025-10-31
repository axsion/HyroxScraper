/**
 * HYROX Scraper v36.3 – Render Free Tier (Firefox Auto)
 * -------------------------------------------------------------
 * ✅ Uses Playwright-Firefox (lightweight headless browser)
 * ✅ Automatically installs Firefox at each startup via start command
 * ✅ Falls back to static Cheerio parsing
 * ✅ 100 % compatible with Render Free Tier (no Chromium cache issues)
 * -------------------------------------------------------------
 */

import express from "express";
import fetch from "node-fetch";
import * as cheerio from "cheerio";
import { firefox } from "playwright-firefox";

const app = express();
const PORT = process.env.PORT || 1000;
app.use(express.json({ limit: "10mb" }));

// ---------------- Cache ----------------
let cache = Object.create(null);

// ---------------- Config ----------------
const AGE_GROUPS = {
  s8: ["45-49","50-54","55-59","60-64","65-69","70-74","75-79"],
  s7: ["50-59","60-69"]
};

const EVENT_TYPES = [
  { key:"men",label:"SOLO MEN" },
  { key:"women",label:"SOLO WOMEN" },
  { key:"doubles-men",label:"DOUBLE MEN" },
  { key:"doubles-women",label:"DOUBLE WOMEN" },
  { key:"doubles-mixed",label:"DOUBLE MIXED" }
];

const UA = "Mozilla/5.0 (X11; Linux x86_64; rv:118.0) Gecko/20100101 Firefox/118.0";

// ---------------- Helpers ----------------
async function loadEventList() {
  const url = "https://raw.githubusercontent.com/axsion/HyroxScraper/main/events.txt";
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Failed to load events list (${res.status})`);
  const text = await res.text();
  return text.split(/\r?\n/).map(u => u.trim()).filter(u => u.startsWith("http"));
}

function parseEventUrl(u) {
  const m = u.match(/\/ranking\/(s\d+)-(\d{4})-([^/?#]+)/i);
  return {
    season: m?.[1]?.toLowerCase() || "s8",
    year: m?.[2] || "2025",
    city: (m?.[3] || "unknown").toUpperCase()
  };
}

function buildStrictUrl(base, typeKey, age) {
  if (typeKey.startsWith("doubles-")) {
    const gender = typeKey.split("-")[1];
    return `${base}-hyrox-doubles-${gender}?ag=${encodeURIComponent(age)}`;
  } else {
    return `${base}-hyrox-${typeKey}?ag=${encodeURIComponent(age)}`;
  }
}

const sleep = (ms) => new Promise(r => setTimeout(r, ms));

function extractPodium(html) {
  const $ = cheerio.load(html);
  let rows = $(".ranking-table tbody tr");
  if (!rows.length) rows = $(".table-ranking tbody tr");
  const podium = [];
  rows.slice(0,3).each((_,row)=>{
    const c = $(row).find("td");
    const name = $(c[1]).text().trim();
    const time = $(c[4]).text().trim();
    if (name && time) podium.push({ name, time });
  });
  return podium;
}

// ---------------- Scraping ----------------
async function fetchRenderedHtml(url) {
  let browser;
  try {
    browser = await firefox.launch({ headless: true });
    const context = await browser.newContext({ userAgent: UA });
    const page = await context.newPage();
    await page.goto(url, { waitUntil: "networkidle", timeout: 45000 });
    await page.waitForTimeout(1500);
    const html = await page.content();
    await browser.close();
    return html;
  } catch (e) {
    if (browser) await browser.close();
    console.log(`⚠️ Firefox failed: ${e.message}`);
    return null;
  }
}

async function scrapeEvent(eventUrl) {
  const { season, year, city } = parseEventUrl(eventUrl);
  const groups = AGE_GROUPS[season] || AGE_GROUPS.s8;
  const results = [];

  for (const type of EVENT_TYPES) {
    for (const age of groups) {
      const key = `${season}_${year}_${city}_${type.key}_${age}`;
      if (cache[key]) continue;

      const url = buildStrictUrl(eventUrl, type.key, age);
      console.log("🔎", url);

      let podium = [];

      // 1. Try static HTML
      try {
        const res = await fetch(url, { headers: { "User-Agent": UA } });
        if (res.ok) {
          const html = await res.text();
          podium = extractPodium(html);
        }
      } catch (_) {}

      // 2. If not found, render with Firefox
      if (!podium.length) {
        const html = await fetchRenderedHtml(url);
        if (html) podium = extractPodium(html);
      }

      if (podium.length) {
        const data = {
          key,
          eventName: `Ranking of ${year} ${city} HYROX ${type.label}`,
          city, year, season, category: age,
          gender: type.key.includes("men")
            ? "Men"
            : type.key.includes("women")
            ? "Women"
            : "Mixed",
          type: type.key.includes("doubles") ? "Double" : "Solo",
          podium, url
        };
        cache[key] = data;
        results.push(data);
        console.log(`✅ Added ${city} ${type.key} ${age}`);
      } else {
        console.log(`⚠️ No podium for ${city} ${type.key} ${age}`);
      }

      await sleep(300);
    }
  }

  return results;
}

async function runFullScrape() {
  console.log("🌍 Starting full scrape...");
  const events = await loadEventList();
  let added = 0;
  for (const url of events) {
    const batch = await scrapeEvent(url);
    added += batch.length;
  }
  console.log(`🎯 Done. ${added} podiums added.`);
  return { added, total: Object.keys(cache).length };
}

// ---------------- API Routes ----------------
app.get("/api/health", (req,res)=>{
  res.json({
    status:"ok",
    service:"HYROX Scraper",
    node:process.version,
    time:new Date().toISOString(),
    cacheCount:Object.keys(cache).length
  });
});

app.get("/api/check-events", async (req,res)=>{
  try {
    const urls = await loadEventList();
    res.json({total:urls.length,sample:urls.slice(0,5)});
  } catch(e){
    res.status(500).json({error:e.message});
  }
});

app.get("/api/scrape-all", async (req,res)=>{
  try {
    const result = await runFullScrape();
    res.json(result);
  } catch(e){
    res.status(500).json({error:e.message});
  }
});

app.get("/api/cache", (req,res)=>{
  res.json({events:Object.values(cache)});
});

// ---------------- Start ----------------
app.listen(PORT, ()=>{
  console.log(`🔥 HYROX Scraper v36.3 (Firefox) running on port ${PORT}`);
  console.log("✅ /api/health  ✅ /api/check-events  ✅ /api/scrape-all  ✅ /api/cache");
});
