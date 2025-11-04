/**
 * HYROX Scraper v4.0 – Fly.io + Playwright (background + caching)
 * ---------------------------------------------------------------
 * ✅ Background crawl (HTTP returns immediately, work continues)
 * ✅ Masters only: 45-49, 50-54, 55-59, 60-64, 65-69, 70-74, 75-79, 80-84
 * ✅ Solo (men/women) + Doubles (men/women/mixed)
 * ✅ Dynamic expansion of base event URLs (s7/s8/...); handles 404 index pages
 * ✅ Caching to skip already-scraped URLs (/data/last-scraped.json)
 * ✅ Persistent logs: /data/logs/scraper-YYYYMMDD.txt (+ console)
 * ✅ Endpoints:
 *    - GET  /api/health
 *    - GET  /api/check-events          (expand base list -> final URLs)
 *    - GET  /api/check-new             (shows how many new URLs vs cache)
 *    - POST /api/scrape-all?force=1    (kicks off background crawl)
 *    - POST /api/scrape                (?url=...) scrape a single URL now
 *    - GET  /api/last-run              (time + totals of last full run)
 *    - GET  /api/progress              (live counters / status)
 *    - GET  /api/logs                  (tail last ~200 lines)
 */

import express from "express";
import * as cheerio from "cheerio";
import { chromium } from "playwright";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

// -------------------------------------------------------------------------------------
// Paths / constants
// -------------------------------------------------------------------------------------
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PORT = Number(process.env.PORT || 10000);
const APP_NAME = "HYROX Scraper v4.0";

const DATA_DIR = process.env.DATA_DIR || "/data";
const RESULTS_DIR = path.join(DATA_DIR, "results");
const LOGS_DIR = path.join(DATA_DIR, "logs");
const CACHE_FILE = path.join(DATA_DIR, "last-scraped.json");
const LAST_RUN_FILE = path.join(DATA_DIR, "last-run.json");

// Where your base event list lives (one URL per line, e.g. s8-2025-paris)
const EVENTS_TXT =
  "https://raw.githubusercontent.com/axsion/HyroxScraper/main/events.txt";

// Masters age-groups (as requested)
const MASTER_AGS = ["45-49", "50-54", "55-59", "60-64", "65-69", "70-74", "75-79", "80-84"];

// Divisions to expand from a base event URL
const SOLO_DIVS = ["hyrox-men", "hyrox-women"];
const DOUBLE_DIVS = ["hyrox-doubles-men", "hyrox-doubles-women", "hyrox-doubles-mixed"];

// Playwright launch args (Fly)
const PW_ARGS = ["--no-sandbox", "--disable-dev-shm-usage"];

// -------------------------------------------------------------------------------------
// FS helpers (make sure /data is ready)
// -------------------------------------------------------------------------------------
for (const dir of [DATA_DIR, RESULTS_DIR, LOGS_DIR]) {
  try {
    fs.mkdirSync(dir, { recursive: true });
  } catch {}
}

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
  try {
    fs.appendFileSync(logFile, msg);
  } catch {}
}

function readJSONSafe(file, fallback) {
  try {
    if (!fs.existsSync(file)) return fallback;
    return JSON.parse(fs.readFileSync(file, "utf8"));
  } catch {
    return fallback;
  }
}
function writeJSONSafe(file, obj) {
  try {
    fs.writeFileSync(file, JSON.stringify(obj, null, 2));
    return true;
  } catch (e) {
    appendLog(`⚠️  Failed to write ${file}: ${e.message}`);
    return false;
  }
}

// -------------------------------------------------------------------------------------
// State (progress / background job)
// -------------------------------------------------------------------------------------
let job = {
  running: false,
  startedAt: null,
  finishedAt: null,
  queued: 0,
  done: 0,
  succeeded: 0,
  failed: 0,
  force: false,
  lastError: null,
  lastUrl: null,
};

// heartbeat (so you see life in logs even if scraping is quiet)
setInterval(() => {
  if (job.running) {
    appendLog(
      `💓 heartbeat – queued:${job.queued} done:${job.done} ok:${job.succeeded} fail:${job.failed}`
    );
  }
}, 5000);

// -------------------------------------------------------------------------------------
// Event URL expansion
//   From base: https://www.hyresult.com/ranking/s8-2025-paris
//   To finals: https://www.hyresult.com/ranking/s8-2025-paris-hyrox-men?ag=45-49, etc.
// -------------------------------------------------------------------------------------
async function fetchBaseEvents() {
  const res = await fetch(EVENTS_TXT, { cache: "no-store" });
  if (!res.ok) throw new Error(`Failed to fetch events.txt: ${res.status}`);
  const text = await res.text();
  return text
    .split("\n")
    .map((s) => s.trim())
    .filter((s) => s.startsWith("http"));
}

function expandEvents(baseUrls) {
  const finals = [];
  for (const base of baseUrls) {
    // only masters requested
    for (const ag of MASTER_AGS) {
      for (const div of SOLO_DIVS) {
        finals.push(`${base}-${div}?ag=${encodeURIComponent(ag)}`);
      }
      for (const div of DOUBLE_DIVS) {
        finals.push(`${base}-${div}?ag=${encodeURIComponent(ag)}`);
      }
    }
  }
  return finals;
}

// -------------------------------------------------------------------------------------
// Scraper (podium extraction)
//   Tries to be resilient to small DOM variations.
//   Returns {success, meta, podium: {gold, silver, bronze}} or {success:false, error}
// -------------------------------------------------------------------------------------
async function scrapeOne(url) {
  job.lastUrl = url;
  appendLog(`🔎 Opening ${url}`);

  const browser = await chromium.launch({ headless: true, args: PW_ARGS });
  try {
    const page = await browser.newPage();
    await page.goto(url, { waitUntil: "domcontentloaded", timeout: 60000 });

    // Wait for some table-like structure (best effort)
    await page.waitForTimeout(1000);
    const html = await page.content();
    const $ = cheerio.load(html);

    // Title / metadata
    const title = ($("h1").first().text() || $("title").text() || "").trim();

    // Try a few likely table patterns to collect podium rows
    // We’ll search for rows that look like 1/2/3 or "1." in first cell
    let rows = [];
    $("table tr").each((_, el) => {
      const tds = $(el).find("td");
      if (tds.length >= 3) {
        const posText = $(tds[0]).text().trim();
        if (/^1$|^1\./.test(posText) || /^2$|^2\./.test(posText) || /^3$|^3\./.test(posText)) {
          rows.push(
            tds
              .map((i, td) => $(td).text().trim())
              .get()
              .slice(0, 5) // keep a handful of columns
          );
        }
      }
    });

    // Fallback: look for cards/lists
    if (rows.length < 3) {
      const cards = [];
      $("[class*='podium'],[class*='rank'],[class*='result']").each((_, el) => {
        const txt = $(el).text().trim();
        if (/\b1\b|\b2\b|\b3\b/.test(txt)) cards.push(txt);
      });
      // Not structured; we won't try to parse more – signal not found gracefully.
      if (cards.length === 0) {
        return {
          success: false,
          meta: { url, title },
          error: "Could not locate a podium table",
        };
      }
    }

    // Convert to { position, name, time } best-effort
    // (Positions are 1,2,3 rows in "rows")
    function parseRowToObj(row) {
      // Heuristic: row[0]=pos, row[1]=name, row[2] or row[3]=time
      const pos = String(row[0] || "").replace(/\D/g, "");
      const name = row[1] || row[2] || "";
      const time = row[2] || row[3] || "";
      return { pos, name, time };
    }

    const podiumRows = rows.filter((r) => /^1$|^2$|^3$/.test(String(r[0]).replace(/\D/g, "")));
    if (podiumRows.length < 3) {
      return {
        success: false,
        meta: { url, title },
        error: "Found table but not enough podium rows",
      };
    }

    const gold = parseRowToObj(podiumRows.find((r) => /^\D*1\D*$|^1$/.test(String(r[0]))));
    const silver = parseRowToObj(podiumRows.find((r) => /^\D*2\D*$|^2$/.test(String(r[0]))));
    const bronze = parseRowToObj(podiumRows.find((r) => /^\D*3\D*$|^3$/.test(String(r[0]))));

    return {
      success: true,
      meta: { url, title },
      podium: { gold, silver, bronze },
    };
  } catch (e) {
    return { success: false, meta: { url }, error: e.message };
  } finally {
    await browser.close().catch(() => {});
  }
}

// -------------------------------------------------------------------------------------
// Background queue (simple promise pool)
// -------------------------------------------------------------------------------------
async function runQueue(urls, { force = false, concurrency = 2 } = {}) {
  job.running = true;
  job.startedAt = new Date().toISOString();
  job.finishedAt = null;
  job.force = !!force;
  job.queued = urls.length;
  job.done = 0;
  job.succeeded = 0;
  job.failed = 0;
  job.lastError = null;

  appendLog(
    `🚀 Starting crawl – urls:${urls.length} force:${force ? "yes" : "no"} concurrency:${concurrency}`
  );

  // Prepare cache
  const cache = readJSONSafe(CACHE_FILE, { done: [] });
  const doneSet = new Set(cache.done || []);

  const toRun = force ? urls : urls.filter((u) => !doneSet.has(u));
  appendLog(`🧮 After filtering, will scrape: ${toRun.length}`);

  // Write last-run start snapshot
  writeJSONSafe(LAST_RUN_FILE, {
    startedAt: job.startedAt,
    totalPlanned: toRun.length,
    force,
  });

  const resultsToday = [];

  // simple pool
  const pool = new Set();
  async function spawn(nextUrl) {
    if (!nextUrl) return;
    const p = (async () => {
      const res = await scrapeOne(nextUrl);
      job.done += 1;

      if (res.success) {
        job.succeeded += 1;
        doneSet.add(nextUrl);
        resultsToday.push(res);
        appendLog(`✅ [${job.done}/${job.queued}] OK: ${nextUrl}`);
      } else {
        job.failed += 1;
        job.lastError = res.error || "unknown";
        appendLog(`❌ [${job.done}/${job.queued}] FAIL: ${nextUrl} – ${job.lastError}`);
      }
    })()
      .catch((e) => {
        job.done += 1;
        job.failed += 1;
        job.lastError = e.message;
        appendLog(`❌ [${job.done}/${job.queued}] EXC: ${nextUrl} – ${e.message}`);
      })
      .finally(() => pool.delete(p));

    pool.add(p);
  }

  // kick off first batch
  let idx = 0;
  while (idx < toRun.length || pool.size) {
    while (pool.size < concurrency && idx < toRun.length) {
      await spawn(toRun[idx++]);
    }
    // small pause to avoid hot loop
    await new Promise((r) => setTimeout(r, 50));
  }

  // Persist results and cache
  writeJSONSafe(CACHE_FILE, { done: Array.from(doneSet) });

  const outFile = path.join(RESULTS_DIR, `results-${todayStamp()}.json`);
  writeJSONSafe(outFile, { date: new Date().toISOString(), results: resultsToday });

  job.finishedAt = new Date().toISOString();
  writeJSONSafe(LAST_RUN_FILE, {
    startedAt: job.startedAt,
    finishedAt: job.finishedAt,
    totalPlanned: toRun.length,
    succeeded: job.succeeded,
    failed: job.failed,
    cacheSize: doneSet.size,
    outFile,
  });

  appendLog(
    `🏁 Crawl finished – ok:${job.succeeded} fail:${job.failed} wrote:${outFile} cache:${doneSet.size}`
  );
  job.running = false;
}

// -------------------------------------------------------------------------------------
// Express app / endpoints
// -------------------------------------------------------------------------------------
const app = express();

app.get("/api/health", (_, res) => {
  res.json({ ok: true, app: APP_NAME, now: new Date().toISOString() });
});

// Expand list for visibility/debugging
app.get("/api/check-events", async (_, res) => {
  try {
    const base = await fetchBaseEvents();
    const finals = expandEvents(base);
    res.json({ baseCount: base.length, total: finals.length, sample: finals.slice(0, 10) });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// Compare remote expanded list vs cache
app.get("/api/check-new", async (_, res) => {
  try {
    const base = await fetchBaseEvents();
    const finals = expandEvents(base);
    const cache = readJSONSafe(CACHE_FILE, { done: [] });
    const doneSet = new Set(cache.done || []);
    const newOnes = finals.filter((u) => !doneSet.has(u));
    res.json({
      totalRemote: finals.length,
      cached: doneSet.size,
      newEvents: newOnes.length,
      sample: newOnes.slice(0, 10),
    });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// Scrape a single URL immediately
app.post("/api/scrape", async (req, res) => {
  const url = req.query.url || req.body?.url;
  if (!url) return res.status(400).json({ error: "Missing ?url=..." });
  try {
    const result = await scrapeOne(String(url));
    // if successful, add to cache
    if (result.success) {
      const cache = readJSONSafe(CACHE_FILE, { done: [] });
      const set = new Set(cache.done || []);
      set.add(String(url));
      writeJSONSafe(CACHE_FILE, { done: Array.from(set) });
    }
    res.json(result);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// Kick off background full crawl
app.post("/api/scrape-all", async (req, res) => {
  if (job.running) {
    return res.status(409).json({ running: true, message: "A crawl is already running." });
  }
  const force = ["1", "true", "yes"].includes(String(req.query.force || "").toLowerCase());
  try {
    const base = await fetchBaseEvents();
    const finals = expandEvents(base);
    // start background (do not await)
    runQueue(finals, { force, concurrency: 2 }).catch((e) =>
      appendLog(`❌ Background error: ${e.message}`)
    );
    return res.status(202).json({
      accepted: true,
      planned: finals.length,
      force,
      note: "Crawl started in background. Check /api/progress and /api/logs.",
    });
  } catch (e) {
    return res.status(500).json({ error: e.message });
  }
});

// Progress endpoint
app.get("/api/progress", (_, res) => {
  res.json({
    running: job.running,
    startedAt: job.startedAt,
    finishedAt: job.finishedAt,
    queued: job.queued,
    done: job.done,
    succeeded: job.succeeded,
    failed: job.failed,
    lastUrl: job.lastUrl,
    lastError: job.lastError,
  });
});

// Last run summary
app.get("/api/last-run", (_, res) => {
  const data = readJSONSafe(LAST_RUN_FILE, null);
  if (!data) return res.status(404).json({ error: "No last-run data yet." });
  res.json(data);
});

// Tail logs (last ~200 lines)
app.get("/api/logs", (_, res) => {
  try {
    if (!fs.existsSync(logFile)) return res.json({ lines: [] });
    const text = fs.readFileSync(logFile, "utf8");
    const lines = text.trim().split("\n");
    res.json({ file: path.basename(logFile), lines: lines.slice(-200) });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// Simple root
app.get("/", (_, res) => {
  res.send(
    `✅ ${APP_NAME} listening on ${PORT}<br/>
     <pre>
GET  /api/health
GET  /api/check-events
GET  /api/check-new
POST /api/scrape?url=...
POST /api/scrape-all?force=1
GET  /api/progress
GET  /api/last-run
GET  /api/logs
     </pre>`
  );
});

// Start server
app.listen(PORT, "0.0.0.0", () => {
  appendLog(`✅ ${APP_NAME} listening on ${PORT}`);
});
