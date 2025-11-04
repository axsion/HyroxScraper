/**
 * HYROX Scraper v3.8 – Fly.io + Persistent /data + Masters-only
 * --------------------------------------------------------------
 * ✅ Expands base event URLs into category+age URLs (Masters only)
 * ✅ Extracts podiums (Gold/Silver/Bronze)
 * ✅ Persists state in /data/state.json (skip already-crawled)
 * ✅ Endpoints:
 *    - GET /api/health
 *    - GET /api/check-events
 *    - GET /api/scrape?url=<expandedUrl>
 *    - GET /api/scrape-all               (incremental: new only)
 *    - GET /api/scrape-all?force=true    (force: recrawl everything)
 *    - GET /api/last-run
 *    - GET /
 */

import express from "express";
import fetch from "node-fetch";
import * as cheerio from "cheerio";
import { chromium } from "playwright";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PORT = process.env.PORT || 10000;
const app = express();

// ---------- Config ----------
const EVENTS_URL = "https://raw.githubusercontent.com/axsion/HyroxScraper/main/events.txt";

// Masters-only age groups (default for S8+). We’ll intersect with discovered AGs if available.
const MASTER_AGS_DEFAULT = [
  "45-49","50-54","55-59","60-64","65-69","70-74","75-79","80-84"
];

// Solo & Doubles only (no relays)
const CATEGORIES = [
  "hyrox-men",
  "hyrox-women",
  "hyrox-doubles-men",
  "hyrox-doubles-women",
  "hyrox-doubles-mixed",
];

// Persistent state
const DATA_DIR = "/data";
const STATE_FILE = path.join(DATA_DIR, "state.json");
if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });

// ---------- State helpers ----------
function loadState() {
  if (!fs.existsSync(STATE_FILE)) {
    return { version: "3.8.0", firstSeen: new Date().toISOString(), lastRun: null, done: {}, failed: {}, results: [] };
  }
  try {
    const json = JSON.parse(fs.readFileSync(STATE_FILE, "utf8"));
    if (!json.done) json.done = {};
    if (!json.failed) json.failed = {};
    if (!json.results) json.results = [];
    return json;
  } catch {
    return { version: "3.8.0", firstSeen: new Date().toISOString(), lastRun: null, done: {}, failed: {}, results: [] };
  }
}
function saveState(state) {
  state.lastRun = new Date().toISOString();
  fs.writeFileSync(STATE_FILE, JSON.stringify(state, null, 2));
}

// ---------- Utility ----------
function toEventMeta(expandedUrl) {
  // Extract bits like: /ranking/s8-2025-paris-hyrox-men?ag=45-49
  try {
    const u = new URL(expandedUrl);
    const slug = u.pathname.split("/").filter(Boolean).pop() || "";
    const ag = u.searchParams.get("ag") || "";
    // slug example: s8-2025-paris-hyrox-men
    const parts = slug.split("-");
    const season = parts[0]; // s8, s7...
    const year = parts[1];   // 2025, 2024...
    // city = everything between year and category start
    const catIdx = parts.findIndex(p => p === "hyrox");
    let city = slug;
    if (catIdx > 0) {
      city = parts.slice(2, catIdx).join("-");
    }
    let category = "hyrox-men";
    const cat = slug.match(/hyrox-(men|women|doubles-men|doubles-women|doubles-mixed)/i);
    if (cat) category = `hyrox-${cat[1].toLowerCase()}`;

    return { season, year, city, category, ageGroup: ag };
  } catch {
    return { season: "", year: "", city: "", category: "", ageGroup: "" };
  }
}

function buildExpandedUrls(baseUrl, masterAgs = MASTER_AGS_DEFAULT) {
  // baseUrl: https://www.hyresult.com/ranking/s8-2025-paris
  const base = baseUrl.replace(/\/+$/, "");
  return CATEGORIES.flatMap(cat => 
    masterAgs.map(ag => `${base}-${cat}?ag=${encodeURIComponent(ag)}`)
  );
}

// Extract top3 podium rows from a HYROX results table.
// Tries to be robust across minor markup changes.
function extractPodium($) {
  // Find a table that looks like results (has tbody > tr with multiple tds)
  const tables = $("table");
  let chosen;
  tables.each((_, el) => {
    const rows = $(el).find("tbody tr");
    if (rows.length >= 3 && $(el).find("th").length >= 2) {
      chosen = $(el);
      return false;
    }
  });
  if (!chosen) return null;

  const rows = chosen.find("tbody tr").slice(0, 3); // top 3
  const podium = [];
  rows.each((i, tr) => {
    const tds = $(tr).find("td").toArray().map(td => $(td).text().trim());
    // Heuristic:
    // - Rank often in tds[0] or contains "1"/"2"/"3"
    // - Name usually in a mid column
    // - Time is the last td with pattern 00:00:00 (hh:mm:ss) or mm:ss
    const timeRegex = /\b\d{1,2}:\d{2}:\d{2}\b|\b\d{1,2}:\d{2}\b/;
    let time = "";
    let timeIdx = -1;
    for (let idx = tds.length - 1; idx >= 0; idx--) {
      if (timeRegex.test(tds[idx])) { time = tds[idx]; timeIdx = idx; break; }
    }
    // Pick a "name" cell: prefer the cell before time, else the longest non-time cell
    let name = "";
    if (timeIdx > 0) {
      name = tds[timeIdx - 1];
    } else {
      name = [...tds].filter(x => !timeRegex.test(x)).sort((a,b)=>b.length-a.length)[0] || "";
    }
    podium.push({
      rank: (i+1),
      name: name.replace(/\s+/g, " ").trim(),
      time: time
    });
  });

  if (podium.length < 3) return null;
  return { gold: podium[0], silver: podium[1], bronze: podium[2] };
}

// ---------- Browser ----------
async function withBrowser(fn) {
  const browser = await chromium.launch({
    headless: true,
    args: ["--no-sandbox", "--disable-dev-shm-usage", "--disable-setuid-sandbox", "--disable-gpu"]
  });
  try {
    return await fn(browser);
  } finally {
    await browser.close();
  }
}

async function scrapeExpandedUrl(expandedUrl) {
  return withBrowser(async (browser) => {
    const page = await browser.newPage();
    await page.goto(expandedUrl, { waitUntil: "domcontentloaded", timeout: 60000 });

    // Short-circuit on obvious 404 text
    const status = page.response()?.status();
    const html = await page.content();

    if (status && status >= 400) {
      throw new Error(`HTTP ${status}`);
    }
    if (/404/i.test(html) && /not\s+found/i.test(html)) {
      throw new Error("404 content");
    }

    const $ = cheerio.load(html);
    const podium = extractPodium($);
    if (!podium) {
      throw new Error("No podium table detected");
    }

    const title = $("title").text().trim();
    const meta = toEventMeta(expandedUrl);

    return {
      ...meta,
      title,
      url: expandedUrl,
      podium
    };
  });
}

// ---------- Routes ----------
app.get("/api/health", (req, res) => {
  res.json({ ok: true, service: "HYROX Scraper", version: "3.8.0" });
});

app.get("/api/check-events", async (req, res) => {
  try {
    const state = loadState();
    const r = await fetch(EVENTS_URL);
    const text = await r.text();
    const bases = text.split("\n").map(l => l.trim()).filter(l => l.startsWith("http"));
    const expanded = bases.flatMap(u => buildExpandedUrls(u));

    const doneSet = new Set(Object.keys(state.done));
    const pending = expanded.filter(u => !doneSet.has(u));
    res.json({ bases: bases.length, expanded: expanded.length, pending: pending.length, sample: pending.slice(0, 10) });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.get("/api/scrape", async (req, res) => {
  const { url } = req.query;
  if (!url) return res.status(400).json({ error: "Missing ?url=" });

  const state = loadState();
  try {
    const result = await scrapeExpandedUrl(String(url));
    // persist
    state.results.push(result);
    state.done[url] = { when: new Date().toISOString(), status: "ok" };
    saveState(state);
    res.json({ ok: true, result });
  } catch (e) {
    state.failed[url] = { when: new Date().toISOString(), error: e.message };
    saveState(state);
    res.status(502).json({ ok: false, url, error: e.message });
  }
});

app.get("/api/scrape-all", async (req, res) => {
  const force = String(req.query.force || "false").toLowerCase() === "true";
  const state = loadState();
  const start = Date.now();

  try {
    const r = await fetch(EVENTS_URL);
    const text = await r.text();
    const bases = text.split("\n").map(l => l.trim()).filter(l => l.startsWith("http"));
    const expanded = bases.flatMap(u => buildExpandedUrls(u));

    const doneSet = new Set(Object.keys(state.done));
    const worklist = force ? expanded : expanded.filter(u => !doneSet.has(u));

    let okCount = 0, failCount = 0;
    const batchResults = [];

    // Sequential to avoid hammering the target site. (You can parallelize with care.)
    for (const url of worklist) {
      try {
        const result = await scrapeExpandedUrl(url);
        state.results.push(result);
        state.done[url] = { when: new Date().toISOString(), status: "ok" };
        batchResults.push({ url, ok: true });
        okCount++;
      } catch (e) {
        state.failed[url] = { when: new Date().toISOString(), error: e.message };
        batchResults.push({ url, ok: false, error: e.message });
        failCount++;
      }
      // Optional tiny delay to be polite
      await new Promise(r => setTimeout(r, 250));
    }

    saveState(state);

    const sec = ((Date.now() - start)/1000).toFixed(1);
    res.json({
      ok: true,
      force,
      bases: bases.length,
      expanded: expanded.length,
      attempted: worklist.length,
      success: okCount,
      failed: failCount,
      duration_sec: Number(sec),
      lastRun: state.lastRun
    });
  } catch (e) {
    saveState(state);
    res.status(500).json({ ok: false, error: e.message });
  }
});

app.get("/api/last-run", (req, res) => {
  if (!fs.existsSync(STATE_FILE)) return res.status(404).json({ error: "No runs yet" });
  const state = loadState();
  res.json({
    version: state.version,
    firstSeen: state.firstSeen,
    lastRun: state.lastRun,
    totals: {
      results: state.results.length,
      done: Object.keys(state.done).length,
      failed: Object.keys(state.failed).length
    }
  });
});

app.get("/", (req, res) => {
  res.send(`
    <h1>🏃‍♂️ HYROX Scraper v3.8</h1>
    <p>Masters-only (Solo & Doubles), persistent /data, incremental crawling.</p>
    <ul>
      <li><a href="/api/health">/api/health</a></li>
      <li><a href="/api/check-events">/api/check-events</a></li>
      <li><a href="/api/scrape-all">/api/scrape-all</a> (incremental)</li>
      <li><a href="/api/scrape-all?force=true">/api/scrape-all?force=true</a> (full)</li>
      <li><a href="/api/last-run">/api/last-run</a></li>
    </ul>
  `);
});

app.listen(PORT, "0.0.0.0", () => {
  console.log(`✅ HYROX Scraper v3.8 listening on ${PORT}`);
});
