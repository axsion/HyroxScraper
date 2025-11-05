/**
 * HYROX Podium Scraper - Fly.io friendly (No Playwright)
 * ------------------------------------------------------
 * Strategy (tiered for resilience):
 * 1) Try extracting __NEXT_DATA__ JSON from base page.
 * 2) If missing/invalid, discover ?ag= categories from HTML and fetch each category page; parse podium <table>.
 * 3) If the HTML is still not providing data (e.g., client-only hydration), use a minimal headless rescue:
 *    puppeteer-core + @sparticuz/chromium (only for that event).
 *
 * Endpoints:
 *  - GET /api/health
 *  - GET /api/check-events
 *  - POST/GET /api/scrape?url=...&force=true|false
 *  - POST/GET /api/scrape-all?force=true|false
 *
 * Events source of truth:
 *   https://raw.githubusercontent.com/axsion/HyroxScraper/main/events.txt
 *
 * Persistent progress (skip logic):
 *   /data/scraped.json  => { "<eventSlug>": { last_scraped, status, last_found_categories: [...] } }
 *
 * Output rows (exact order):
 *   Event plus Cat | Event | City | Date | Category | Gender | Gold | Time1 | Silver | Time2 | Bronze | Time3
 */

import express from "express";
import fetch from "node-fetch";
import * as cheerio from "cheerio";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

// Rare fallback
import chromium from "@sparticuz/chromium";
import puppeteer from "puppeteer-core";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PORT = process.env.PORT || 8080;
const app = express();

app.use(express.json({ limit: "1mb" }));

// ---------- Config ----------
const EVENTS_TXT_URL =
  "https://raw.githubusercontent.com/axsion/HyroxScraper/main/events.txt";

const DATA_DIR = "/data";
const SCRAPED_PATH = path.join(DATA_DIR, "scraped.json");

// Ensure /data exists
if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
if (!fs.existsSync(SCRAPED_PATH)) fs.writeFileSync(SCRAPED_PATH, JSON.stringify({}, null, 2));

// ---------- Helpers ----------
const readScraped = () => JSON.parse(fs.readFileSync(SCRAPED_PATH, "utf8"));
const writeScraped = (obj) => fs.writeFileSync(SCRAPED_PATH, JSON.stringify(obj, null, 2));

function slugFromUrl(url) {
  // e.g., https://www.hyresult.com/ranking/s8-2025-valencia-hyrox-men
  const m = url.match(/ranking\/([^/?#]+)/i);
  return m ? m[1] : url;
}

function deriveMetaFromUrl(url) {
  // Example slug: s8-2025-valencia-hyrox-men
  const slug = slugFromUrl(url);
  // Year
  const yearMatch = slug.match(/s\d-(\d{4})-/i);
  const year = yearMatch ? yearMatch[1] : "";
  // City
  // get the segment between year and "-hyrox-"
  const cityMatch = slug.match(/\d{4}-([a-z0-9-]+)-hyrox-/i);
  const citySlug = cityMatch ? cityMatch[1] : "";
  const city = citySlug
    .split("-")
    .map((s) => (s ? s[0].toUpperCase() + s.slice(1) : s))
    .join(" ");
  // Gender
  const gender = /hyrox-women/i.test(slug) ? "WOMEN" : "MEN";

  const eventTitle = `Ranking of ${year} ${city} HYROX ${gender}`;
  return { slug, year, city, gender, eventTitle };
}

function buildRow({ eventTitle, city, year, ageCat, gender, podium }) {
  // "Event plus Cat" = Event + Category (no space between MEN and 45-49, per example)
  // Example Event: "Ranking of 2025 Valencia HYROX MEN"
  const eventPlusCat = `${eventTitle}${ageCat}`;
  // podium = [{name, time}, ...] top 3
  const [g = {}, s = {}, b = {}] = podium;

  return [
    eventPlusCat,         // Event plus Cat
    eventTitle,           // Event
    city,                 // City
    year,                 // Date (YYYY)
    ageCat,               // Category (age group)
    gender,               // Gender
    g.name || "",         // Gold
    g.time || "",         // Time1
    s.name || "",         // Silver
    s.time || "",         // Time2
    b.name || "",         // Bronze
    b.time || "",         // Time3
  ];
}

function uniqueByKey(rows) {
  // De-duplicate using "Event plus Cat" (col 0) as key
  const seen = new Set();
  const out = [];
  for (const r of rows) {
    const key = r[0];
    if (!seen.has(key)) {
      seen.add(key);
      out.push(r);
    }
  }
  return out;
}

async function fetchText(url) {
  const res = await fetch(url, {
    headers: {
      "User-Agent":
        "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/119 Safari/537.36",
      "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
    },
    redirect: "follow",
  });
  if (!res.ok) {
    throw new Error(`Fetch ${url} failed: ${res.status} ${res.statusText}`);
  }
  return await res.text();
}

// --------- Tier 1: __NEXT_DATA__ extraction ----------
function parseNextDataCategoriesAndPodiums(html) {
  const $ = cheerio.load(html);
  const script = $('#__NEXT_DATA__').first().text().trim();
  if (!script) throw new Error("__NEXT_DATA__ not found");
  let json;
  try {
    json = JSON.parse(script);
  } catch (e) {
    throw new Error("Invalid __NEXT_DATA__ JSON");
  }

  // We do not know the exact schema; try best-effort discovery:
  // Look for a deep object containing categories/age groups and results with name + time.
  // Heuristics:
  // - Find arrays with length >= 3 where objects have {name, time} or similar keys.
  // - Also collect available age-group keys (like '45-49').

  const podiumByCat = {};
  const ageCats = new Set();

  function walk(node, path = []) {
    if (!node) return;
    if (Array.isArray(node)) {
      // Potential results array?
      if (node.length >= 3 && node.every((x) => typeof x === "object" && x)) {
        // Try extract top-3 {name,time}
        const podium = node.slice(0, 3).map((row) => {
          const name =
            row.name || row.athleteName || row.athlete || row.fullName || row.displayName || "";
          const time =
            row.time || row.finishTime || row.resultTime || row.totalTime || row.duration || "";
          return { name, time };
        });
        // If we found 3 names+times, attach to a nearby category label if present in path
        const pathStr = path.join(".");
        const catFromPath =
          pathStr.match(/(45-49|50-54|55-59|60-64|65-69|70-74|75-79|40-44|35-39|30-34)/)?.[1] || null;

        if (podium.every((p) => p.name && p.time)) {
          const key = catFromPath || "UNKNOWN";
          if (!podiumByCat[key]) podiumByCat[key] = podium;
        }
      }
      node.forEach((v, i) => walk(v, path.concat(i)));
    } else if (typeof node === "object") {
      // capture age group hints
      for (const [k, v] of Object.entries(node)) {
        if (/^\d{2}-\d{2}$/.test(k)) ageCats.add(k);
        if (typeof v === "string" && /^\d{2}-\d{2}$/.test(v)) ageCats.add(v);
      }
      for (const [k, v] of Object.entries(node)) {
        walk(v, path.concat(k));
      }
    }
  }

  walk(json);

  const discoveredCats = [...ageCats];
  const podiums = Object.entries(podiumByCat)
    .filter(([cat]) => /^\d{2}-\d{2}$/.test(cat))
    .map(([cat, podium]) => ({ cat, podium }));

  if (!discoveredCats.length && !podiums.length) {
    throw new Error("NEXT_DATA heuristic failed to locate categories/podiums");
  }

  return { discoveredCats, podiums }; // podiums may be empty; we can still fetch per-cat pages if needed
}

// --------- Tier 2: HTML (and per-category page) parsing ----------
function discoverAgeCategoriesFromHtml(html) {
  const $ = cheerio.load(html);
  const set = new Set();

  // Look for links or options with ?ag=XX
  $('a[href*="?ag="], option[value*="?ag="], a[href*="ag="], option[value*="ag="]').each((_, el) => {
    const href = $(el).attr("href") || $(el).attr("value") || "";
    const m = href.match(/[?&]ag=(\d{2}-\d{2})/i);
    if (m) set.add(m[1]);
  });

  // Also look for raw text mentioning age groups
  const text = $.root().text();
  const regex = /(\b\d{2}-\d{2}\b)/g;
  let m;
  while ((m = regex.exec(text))) set.add(m[1]);

  return [...set];
}

function parsePodiumFromTable(html) {
  const $ = cheerio.load(html);
  // Try common table structures
  // Strategy: find a table with header containing Rank/Name/Time (any order), then take first three body rows.
  const tables = $("table");
  for (let i = 0; i < tables.length; i++) {
    const table = tables.eq(i);
    const headers = table.find("thead th, thead td").map((_, th) => $(th).text().trim().toLowerCase()).get();
    const hasName = headers.some((h) => /name|athlete/i.test(h));
    const hasTime = headers.some((h) => /time|result|finish/i.test(h));
    const hasRank = headers.some((h) => /rank|pos/i.test(h));

    if (!hasName || !hasTime) continue; // need at least name and time

    const rows = table.find("tbody tr");
    const podium = [];
    rows.each((idx, tr) => {
      if (idx >= 3) return false;
      const cells = $(tr).find("td, th").map((_, td) => $(td).text().trim()).get();
      // Heuristic: time is in the last cell containing pattern 00:.. or 0:.. etc.
      const time = cells.find((t) => /^\d{1,2}:\d{2}:\d{2}$/.test(t) || /^\d{1,2}:\d{2}$/.test(t)) || "";
      // Name is the longest non-time-ish cell, not rank
      const name = cells
        .filter((t) => t && !/^\d+$/.test(t) && !/^\d{1,2}:\d{2}(:\d{2})?$/.test(t))
        .sort((a, b) => b.length - a.length)[0] || "";
      if (name || time) podium.push({ name, time });
    });

    if (podium.length >= 3) return podium.slice(0, 3);
  }
  return [];
}

async function fetchCategoryPageAndParse(baseUrl, cat) {
  const url = baseUrl.includes("?") ? `${baseUrl}&ag=${encodeURIComponent(cat)}` : `${baseUrl}?ag=${encodeURIComponent(cat)}`;
  const html = await fetchText(url);
  const podium = parsePodiumFromTable(html);
  return { cat, podium, url };
}

// --------- Tier 3: Minimal headless rescue (rare) ----------
async function rescueWithHeadless(baseUrl, cat) {
  // Launch a minimal Chromium for one page, render, then parse the HTML table.
  const executablePath = await chromium.executablePath();
  const browser = await puppeteer.launch({
    executablePath,
    args: chromium.args,
    defaultViewport: chromium.defaultViewport,
    headless: chromium.headless,
  });

  try {
    const page = await browser.newPage();
    const url = cat
      ? (baseUrl.includes("?") ? `${baseUrl}&ag=${encodeURIComponent(cat)}` : `${baseUrl}?ag=${encodeURIComponent(cat)}`)
      : baseUrl;

    await page.goto(url, { waitUntil: "networkidle2", timeout: 60000 });
    // Give SPA a moment if needed
    await page.waitForTimeout(1000);

    const html = await page.content();
    const podium = parsePodiumFromTable(html);
    return { cat: cat || "UNKNOWN", podium, url };
  } finally {
    await browser.close();
  }
}

// --------- Core scrape per event ----------
async function scrapeEventOnce(baseUrl, { force = false } = {}) {
  const meta = deriveMetaFromUrl(baseUrl);
  const progress = readScraped();
  const prev = progress[meta.slug];

  if (prev && prev.status === "complete" && !force) {
    return { meta, rows: [], skipped: true, reason: "already-complete" };
  }

  const rows = [];
  let discoveredCats = [];

  // 1) Try __NEXT_DATA__
  let baseHtml = "";
  try {
    baseHtml = await fetchText(baseUrl);
    const nextInfo = parseNextDataCategoriesAndPodiums(baseHtml);
    discoveredCats = nextInfo.discoveredCats;

    // If NEXT_DATA already contains podiums mapped by cat, use them
    for (const { cat, podium } of nextInfo.podiums) {
      if (!/^\d{2}-\d{2}$/.test(cat)) continue;
      if (podium.length >= 3) {
        rows.push(
          buildRow({
            eventTitle: meta.eventTitle,
            city: meta.city,
            year: meta.year,
            ageCat: cat,
            gender: meta.gender,
            podium,
          })
        );
      }
    }
  } catch (e) {
    // NEXT_DATA path failed; continue to Tier 2
  }

  // 2) If we don't have rows for all cats, discover cats and fetch per-cat pages
  if (!discoveredCats.length) {
    if (!baseHtml) baseHtml = await fetchText(baseUrl);
    discoveredCats = discoverAgeCategoriesFromHtml(baseHtml);
  }

  // Filter to masters style only; if none, keep all discovered
  const masters = discoveredCats.filter((c) => /^(?:3[0-9]|[4-9][0-9])-\d{2}$/.test(c));
  const catsToUse = masters.length ? masters : discoveredCats;

  // For any category we don't yet have a row (from NEXT_DATA podiums), fetch & parse the per-cat page
  const alreadyCats = new Set(rows.map((r) => r[4])); // Category column index = 4
  for (const cat of catsToUse) {
    if (alreadyCats.has(cat)) continue;

    // Try HTML fetch first
    let parsed = await fetchCategoryPageAndParse(baseUrl, cat);

    // If empty podium, attempt headless rescue (rare)
    if ((!parsed.podium || parsed.podium.length < 3)) {
      try {
        parsed = await rescueWithHeadless(baseUrl, cat);
      } catch (_) {
        // ignore rescue failure, leave podium empty
      }
    }

    if (parsed.podium && parsed.podium.length >= 3) {
      rows.push(
        buildRow({
          eventTitle: meta.eventTitle,
          city: meta.city,
          year: meta.year,
          ageCat: cat,
          gender: meta.gender,
          podium: parsed.podium,
        })
      );
    }
  }

  const unique = uniqueByKey(rows);

  // Consider event "complete" if we produced >=1 category rows
  if (unique.length > 0) {
    progress[meta.slug] = {
      last_scraped: new Date().toISOString(),
      status: "complete",
      last_found_categories: catsToUse,
    };
    writeScraped(progress);
  } else {
    progress[meta.slug] = {
      last_scraped: new Date().toISOString(),
      status: "empty-or-failed",
      last_found_categories: catsToUse || [],
    };
    writeScraped(progress);
  }

  return { meta, rows: unique, skipped: false };
}

// --------- API routes ----------
app.get("/api/health", (_req, res) => {
  res.json({ ok: true, service: "hyrox-scraper", time: new Date().toISOString() });
});

app.get("/api/check-events", async (_req, res) => {
  try {
    const txt = await fetchText(EVENTS_TXT_URL);
    const urls = txt
      .split(/\r?\n/)
      .map((l) => l.trim())
      .filter((l) => l && /^https?:\/\//i.test(l));
    const progress = readScraped();
    const list = urls.map((u) => {
      const { slug } = deriveMetaFromUrl(u);
      const p = progress[slug];
      return { url: u, slug, status: p?.status || "pending", last_scraped: p?.last_scraped || null };
    });
    res.json({ total: list.length, events: list });
  } catch (e) {
    res.status(500).json({ error: String(e.message || e) });
  }
});

app.all("/api/scrape", async (req, res) => {
  const url = (req.query.url || req.body?.url || "").toString();
  const force = /^(1|true|yes)$/i.test((req.query.force || req.body?.force || "").toString());
  if (!url) return res.status(400).json({ error: "Missing ?url=" });

  try {
    const out = await scrapeEventOnce(url, { force });
    res.json({
      meta: out.meta,
      skipped: out.skipped,
      rows: out.rows,
    });
  } catch (e) {
    res.status(500).json({ error: String(e.message || e) });
  }
});

app.all("/api/scrape-all", async (req, res) => {
  const force = /^(1|true|yes)$/i.test((req.query.force || req.body?.force || "").toString());
  try {
    const txt = await fetchText(EVENTS_TXT_URL);
    const urls = txt
      .split(/\r?\n/)
      .map((l) => l.trim())
      .filter((l) => l && /^https?:\/\//i.test(l));

    const allRows = [];
    const results = [];
    for (const u of urls) {
      try {
        const r = await scrapeEventOnce(u, { force });
        results.push({ slug: r.meta.slug, skipped: r.skipped, produced: r.rows.length });
        allRows.push(...r.rows);
      } catch (e) {
        results.push({ slug: slugFromUrl(u), error: String(e.message || e) });
      }
    }

    res.json({
      results,
      total_rows: allRows.length,
      // Return rows so Google Sheets can ingest directly
      rows: allRows,
      columns: [
        "Event plus Cat",
        "Event",
        "City",
        "Date",
        "Category",
        "Gender",
        "Gold",
        "Time1",
        "Silver",
        "Time2",
        "Bronze",
        "Time3",
      ],
    });
  } catch (e) {
    res.status(500).json({ error: String(e.message || e) });
  }
});

// Home
app.get("/", (_req, res) => {
  res.type("text/plain").send("HYROX scraper is running. Try /api/health or /api/check-events");
});

app.listen(PORT, () => {
  console.log(`[hyrox-scraper] listening on :${PORT}`);
});
