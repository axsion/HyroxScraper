/**
 * HYROX Scraper v4.1 – Fly.io + Playwright (low-memory safe)
 * -----------------------------------------------------------
 * ✅ Background crawl (HTTP returns immediately)
 * ✅ Masters only: 45-49 → 80-84
 * ✅ Solo + Doubles divisions
 * ✅ Persistent logs (/data/logs)
 * ✅ Cache of completed URLs (/data/last-scraped.json)
 * ✅ Endpoints:
 *    /api/health
 *    /api/check-events
 *    /api/check-new
 *    /api/scrape
 *    /api/scrape-all
 *    /api/progress
 *    /api/last-run
 *    /api/logs
 */

import express from "express";
import * as cheerio from "cheerio";
import { chromium } from "playwright";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PORT = Number(process.env.PORT || 10000);
const APP_NAME = "HYROX Scraper v4.1";

// -----------------------------  File paths  -----------------------------
const DATA_DIR = process.env.DATA_DIR || "/data";
const RESULTS_DIR = path.join(DATA_DIR, "results");
const LOGS_DIR = path.join(DATA_DIR, "logs");
const CACHE_FILE = path.join(DATA_DIR, "last-scraped.json");
const LAST_RUN_FILE = path.join(DATA_DIR, "last-run.json");
for (const dir of [DATA_DIR, RESULTS_DIR, LOGS_DIR]) fs.mkdirSync(dir, { recursive: true });

// -----------------------------  Config  -----------------------------
const EVENTS_TXT =
  "https://raw.githubusercontent.com/axsion/HyroxScraper/main/events.txt";
const MASTER_AGS = ["45-49", "50-54", "55-59", "60-64", "65-69", "70-74", "75-79", "80-84"];
const SOLO_DIVS = ["hyrox-men", "hyrox-women"];
const DOUBLE_DIVS = ["hyrox-doubles-men", "hyrox-doubles-women", "hyrox-doubles-mixed"];

// --- Low-memory Chromium args ---
const PW_ARGS = [
  "--no-sandbox",
  "--disable-setuid-sandbox",
  "--disable-dev-shm-usage",
  "--single-process",
  "--disable-gpu",
  "--no-zygote"
];

// -----------------------------  Helpers  -----------------------------
const todayStamp = () => {
  const d = new Date();
  const z = (n) => String(n).padStart(2, "0");
  return `${d.getUTCFullYear()}${z(d.getUTCMonth() + 1)}${z(d.getUTCDate())}`;
};
const logFile = path.join(LOGS_DIR, `scraper-${todayStamp()}.txt`);
function appendLog(line) {
  const ts = new Date().toISOString();
  const msg = `[${ts}] ${line}\n`;
  process.stdout.write(msg);
  fs.appendFileSync(logFile, msg);
}
function readJSONSafe(file, fallback) {
  try { return JSON.parse(fs.readFileSync(file, "utf8")); } catch { return fallback; }
}
function writeJSONSafe(file, obj) {
  try { fs.writeFileSync(file, JSON.stringify(obj, null, 2)); } catch (e) { appendLog("⚠️ " + e); }
}

// -----------------------------  State  -----------------------------
let job = {
  running: false, startedAt: null, finishedAt: null,
  queued: 0, done: 0, succeeded: 0, failed: 0,
  lastUrl: null, lastError: null
};
setInterval(() => { if (job.running) appendLog(`💓 heartbeat – queued:${job.queued} done:${job.done} ok:${job.succeeded} fail:${job.failed}`); }, 5000);

// -----------------------------  Expand events  -----------------------------
async function fetchBaseEvents() {
  const res = await fetch(EVENTS_TXT, { cache: "no-store" });
  const text = await res.text();
  return text.split("\n").map(s => s.trim()).filter(s => s.startsWith("http"));
}
function expandEvents(baseUrls) {
  const finals = [];
  for (const base of baseUrls) {
    for (const ag of MASTER_AGS) {
      for (const div of SOLO_DIVS) finals.push(`${base}-${div}?ag=${ag}`);
      for (const div of DOUBLE_DIVS) finals.push(`${base}-${div}?ag=${ag}`);
    }
  }
  return finals;
}

// -----------------------------  Scraper core  -----------------------------
async function scrapeOne(url) {
  job.lastUrl = url;
  appendLog(`🔎 Opening ${url}`);
  const browser = await chromium.launch({ headless: true, args: PW_ARGS });
  try {
    const page = await browser.newPage();
    await page.goto(url, { waitUntil: "domcontentloaded", timeout: 60000 });
    await page.waitForTimeout(1000);
    const html = await page.content();
    const $ = cheerio.load(html);
    const title = ($("h1").first().text() || $("title").text() || "").trim();

    // podium rows
    let rows = [];
    $("table tr").each((_, el) => {
      const tds = $(el).find("td");
      if (tds.length >= 3) {
        const pos = $(tds[0]).text().trim();
        if (/^[123]\.?$/.test(pos))
          rows.push(tds.map((i, td) => $(td).text().trim()).get().slice(0, 4));
      }
    });
    if (rows.length < 3)
      return { success: false, meta: { url, title }, error: "No podium rows found" };

    const parse = (r) => ({ pos: r[0], name: r[1], time: r[2] });
    const podium = {
      gold: parse(rows[0]), silver: parse(rows[1]), bronze: parse(rows[2])
    };
    return { success: true, meta: { url, title }, podium };
  } catch (e) {
    return { success: false, meta: { url }, error: e.message };
  } finally { await browser.close().catch(() => {}); }
}

// -----------------------------  Queue  -----------------------------
async function runQueue(urls, { force = false, concurrency = 1 } = {}) {
  job.running = true; job.startedAt = new Date().toISOString();
  job.queued = urls.length; job.done = job.succeeded = job.failed = 0;
  appendLog(`🚀 Starting crawl – urls:${urls.length} force:${force} concurrency:${concurrency}`);

  const cache = readJSONSafe(CACHE_FILE, { done: [] });
  const doneSet = new Set(cache.done);
  const toRun = force ? urls : urls.filter(u => !doneSet.has(u));
  appendLog(`🧮 After filtering, will scrape: ${toRun.length}`);
  writeJSONSafe(LAST_RUN_FILE, { startedAt: job.startedAt, totalPlanned: toRun.length, force });

  const results = [];
  for (const url of toRun) {
    const res = await scrapeOne(url);
    job.done++;
    if (res.success) {
      job.succeeded++; doneSet.add(url); results.push(res);
      appendLog(`✅ [${job.done}/${job.queued}] OK: ${url}`);
    } else {
      job.failed++; job.lastError = res.error;
      appendLog(`❌ [${job.done}/${job.queued}] FAIL: ${url} – ${res.error}`);
    }
  }

  writeJSONSafe(CACHE_FILE, { done: [...doneSet] });
  const outFile = path.join(RESULTS_DIR, `results-${todayStamp()}.json`);
  writeJSONSafe(outFile, { date: new Date().toISOString(), results });

  job.finishedAt = new Date().toISOString();
  writeJSONSafe(LAST_RUN_FILE, {
    startedAt: job.startedAt, finishedAt: job.finishedAt,
    succeeded: job.succeeded, failed: job.failed, cacheSize: doneSet.size
  });
  appendLog(`🏁 Crawl finished – ok:${job.succeeded} fail:${job.failed} cache:${doneSet.size}`);
  job.running = false;
}

// -----------------------------  Express API  -----------------------------
const app = express();

app.get("/api/health", (_, r) => r.json({ ok: true, app: APP_NAME, now: new Date().toISOString() }));

app.get("/api/check-events", async (_, r) => {
  try { const base = await fetchBaseEvents(); const finals = expandEvents(base);
    r.json({ baseCount: base.length, total: finals.length, sample: finals.slice(0,10) });
  } catch (e) { r.status(500).json({ error: e.message }); }
});

app.get("/api/check-new", async (_, r) => {
  try { const base = await fetchBaseEvents(); const finals = expandEvents(base);
    const cache = readJSONSafe(CACHE_FILE, { done: [] });
    const newOnes = finals.filter(u => !cache.done.includes(u));
    r.json({ totalRemote: finals.length, cached: cache.done.length, newEvents: newOnes.length,
      sample: newOnes.slice(0,10) });
  } catch (e) { r.status(500).json({ error: e.message }); }
});

app.post("/api/scrape", async (req, r) => {
  const url = req.query.url; if (!url) return r.status(400).json({ error: "Missing ?url=" });
  const result = await scrapeOne(url);
  if (result.success) {
    const cache = readJSONSafe(CACHE_FILE, { done: [] });
    const set = new Set(cache.done); set.add(url);
    writeJSONSafe(CACHE_FILE, { done: [...set] });
  }
  r.json(result);
});

app.post("/api/scrape-all", async (req, r) => {
  if (job.running) return r.status(409).json({ running: true });
  const force = ["1","true"].includes(String(req.query.force||"").toLowerCase());
  const base = await fetchBaseEvents(); const finals = expandEvents(base);
  runQueue(finals, { force, concurrency: 1 }).catch(e => appendLog("❌ "+e.message));
  r.status(202).json({ accepted: true, planned: finals.length, force,
    note: "Background crawl started. Check /api/progress or /api/logs" });
});

app.get("/api/progress", (_, r) => r.json(job));

app.get("/api/last-run", (_, r) => {
  const d = readJSONSafe(LAST_RUN_FILE, null);
  if (!d) return r.status(404).json({ error: "No last-run yet" });
  r.json(d);
});

app.get("/api/logs", (_, r) => {
  if (!fs.existsSync(logFile)) return r.json({ lines: [] });
  const text = fs.readFileSync(logFile, "utf8").trim().split("\n");
  r.json({ file: path.basename(logFile), lines: text.slice(-200) });
});

app.get("/", (_, r) => r.send(`✅ ${APP_NAME} listening on ${PORT}`));

// -----------------------------  Start  -----------------------------
app.listen(PORT, "0.0.0.0", () => appendLog(`✅ ${APP_NAME} listening on ${PORT}`));
