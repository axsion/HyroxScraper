/**
 * HYROX Scraper v28.0 — Full Recrawl Edition (Render-safe)
 * --------------------------------------------------------
 * ✅ Auto-discovers ALL past event slugs from /events?tab=past
 * ✅ Crawls Solo + Doubles (Men/Women/Mixed) for masters AGs
 * ✅ Handles s7 legacy AGs (50-59, 60-69) + s8 masters (45-49 … 75-79)
 * ✅ Robust parsing across Solo/Doubles/Mixed tables
 * ✅ Retry logic for slower pages (e.g., WOMEN / MIXED)
 * ✅ Incremental cache in /data/last-run.json (restart-safe via Sheet sync)
 * ✅ No 'node-fetch' import; uses global fetch (Node ≥ 18)
 */

import express from "express";
import fs from "fs";
import path from "path";
import { chromium } from "playwright";
import { execSync } from "child_process";

const app = express();
const PORT = process.env.PORT || 1000;

// ───────────────────────────────────────────────────────────
// Storage / Cache
// ───────────────────────────────────────────────────────────
const DATA_DIR = path.join(process.cwd(), "data");
const LAST_RUN_FILE = path.join(DATA_DIR, "last-run.json");
if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });

let cache = { events: [] };
try {
  if (fs.existsSync(LAST_RUN_FILE)) {
    cache = JSON.parse(fs.readFileSync(LAST_RUN_FILE, "utf8"));
    if (!Array.isArray(cache.events)) cache.events = [];
    console.log(`✅ Loaded ${cache.events.length} cached events.`);
  } else {
    console.log("ℹ️ No cache found — starting fresh.");
  }
} catch (e) {
  console.warn("⚠️ Cache read error:", e.message);
  cache = { events: [] };
}

app.use(express.json({ limit: "10mb" })); // prevent PayloadTooLargeError for cache sync

// ───────────────────────────────────────────────────────────
// Ensure Chromium (Render-safe). No sudo/su. Install at start if missing.
// ───────────────────────────────────────────────────────────
(async () => {
  try {
    const PW_DIR = process.env.PLAYWRIGHT_BROWSERS_PATH || "/opt/render/project/.playwright";
    const headlessPath = path.join(PW_DIR, "chromium-headless-shell");
    if (!fs.existsSync(PW_DIR) || !fs.existsSync(headlessPath)) {
      console.log("🧩 Ensuring Chromium runtime is installed...");
      execSync("npx playwright install --with-deps chromium", { stdio: "inherit" });
      console.log("✅ Chromium installed.");
    } else {
      console.log("✅ Chromium already present.");
    }
  } catch (err) {
    console.warn("⚠️ Skipping Chromium install:", err.message);
  }
})();

// ───────────────────────────────────────────────────────────
// Helpers
// ───────────────────────────────────────────────────────────
const MASTER_AGS_S8 = ["45-49","50-54","55-59","60-64","65-69","70-74","75-79"];
const MASTER_AGS_S7 = ["50-59","60-69"];

function ageGroupsForSlug(slug) {
  // s7-2025-* => include legacy s7 groups + s8 (some s7 events still expose 45-49 etc. in practice)
  if (/^s7-/.test(slug)) return [...MASTER_AGS_S8, ...MASTER_AGS_S7];
  return MASTER_AGS_S8;
}

function saveCache() {
  try {
    fs.writeFileSync(LAST_RUN_FILE, JSON.stringify(cache, null, 2));
  } catch (e) {
    console.error("❌ Failed saving cache:", e.message);
  }
}

function uniquePushEvent(event) {
  const key = `${event.eventName}_${event.category}_${event.type}`;
  if (cache.events.some(e => `${e.eventName}_${e.category}_${e.type}` === key)) return false;
  cache.events.push(event);
  saveCache();
  return true;
}

function cityFromSlug(slug) {
  // s8-2025-paris-hyrox  → PARIS
  const m = slug.match(/s\d{1,2}-\d{4}-([a-z-]+)-hyrox/i);
  return m ? m[1].replace(/-/g, " ").toUpperCase() : "UNKNOWN";
}

function yearFromSlug(slug) {
  const m = slug.match(/s\d{1,2}-(\d{4})-/i);
  return m ? m[1] : "2025";
}

function buildBaseUrlsForSlug(slug) {
  // Builds base ranking endpoints (without ?ag=)
  // Solo (men/women)
  const soloMen   = `https://www.hyresult.com/ranking/${slug}-men`;
  const soloWomen = `https://www.hyresult.com/ranking/${slug}-women`;
  // Doubles (men/women/mixed)
  const dblMen    = `https://www.hyresult.com/ranking/${slug}-doubles-men`;
  const dblWomen  = `https://www.hyresult.com/ranking/${slug}-doubles-women`;
  const dblMixed  = `https://www.hyresult.com/ranking/${slug}-doubles-mixed`;
  return [
    { url: soloMen,   type: "Solo",   gender: "Men"   },
    { url: soloWomen, type: "Solo",   gender: "Women" },
    { url: dblMen,    type: "Double", gender: "Men"   },
    { url: dblWomen,  type: "Double", gender: "Women" },
    { url: dblMixed,  type: "Double", gender: "Mixed" },
  ];
}

// Robust text classifiers (client-side compatible)
function normalizeCellText(txt) {
  return (txt || "").replace(/\s+/g, " ").trim();
}
function looksLikeTime(txt) {
  return /^\d{1,2}:\d{2}(:\d{2})?$/.test(txt);
}
function looksLikeNameish(txt) {
  const t = normalizeCellText(txt);
  if (!t) return false;
  if (t.toLowerCase() === "analyze") return false; // ignore UI column
  if (/^\d+$/.test(t)) return false;
  if (/^(dnf|dsq)$/i.test(t)) return false;
  if (looksLikeTime(t)) return false;
  return /[A-Za-zÀ-ÿ]/.test(t);
}

// ───────────────────────────────────────────────────────────
// Scrape Single URL with retries; parse top 3 podium rows
// ───────────────────────────────────────────────────────────
async function scrapePodium(url, { type }) {
  const browser = await chromium.launch({
    headless: true,
    args: ["--no-sandbox", "--disable-dev-shm-usage"]
  });
  const page = await browser.newPage();

  try {
    let attempts = 0;
    while (attempts < 2) {
      try {
        await page.goto(url, { waitUntil: "networkidle", timeout: 60000 });
        break;
      } catch (e) {
        attempts++;
        if (attempts >= 2) throw e;
        console.warn(`🔁 Retry ${attempts} for ${url}`);
        await new Promise(r => setTimeout(r, 1500));
      }
    }

    await page.waitForTimeout(800);

    const rows = await page.$$eval("table tbody tr", (trs) => {
      const looksLikeTime = (txt) => /^\d{1,2}:\d{2}(:\d{2})?$/.test(txt);
      const isNameish = (t) => {
        const s = (t || "").replace(/\s+/g, " ").trim();
        if (!s) return false;
        if (s.toLowerCase() === "analyze") return false;
        if (/^\d+$/.test(s)) return false;
        if (/^(dnf|dsq)$/i.test(s)) return false;
        if (looksLikeTime(s)) return false;
        return /[A-Za-zÀ-ÿ]/.test(s);
      };

      const norm = (t) => (t || "").replace(/\s+/g, " ").trim();

      return trs.slice(0, 3).map(tr => {
        const tds = Array.from(tr.querySelectorAll("td")).map(td => norm(td.innerText));
        const nameCells = tds.filter(isNameish);

        // Join first two name cells for Doubles (Mixed included); single for Solo
        let name = "";
        if (nameCells.length >= 2) name = `${nameCells[0]}, ${nameCells[1]}`;
        else if (nameCells.length === 1) name = nameCells[0];

        const time = (tds.find(looksLikeTime) || "");

        return { name, time };
      }).filter(r => r.name && r.time);
    });

    await browser.close();
    if (!rows.length) {
      console.warn(`⚠️ No podium parsed for ${url}`);
      return null;
    }
    return rows;
  } catch (err) {
    console.error(`❌ ${url}: ${err.message}`);
    await browser.close();
    return null;
  }
}

// ───────────────────────────────────────────────────────────
// Discover ALL past event slugs from /events?tab=past
// ───────────────────────────────────────────────────────────
async function discoverPastSlugs() {
  console.log("🌐 Discovering past event slugs...");
  const resp = await fetch("https://www.hyresult.com/events?tab=past", {
    headers: { "user-agent": "Mozilla/5.0 HYROX-Scraper v28.0" }
  });
  const html = await resp.text();

  // capture ".../ranking/s8-2025-paris-hyrox-<division>" OR base slug before -men/-women/-doubles-*
  // We normalize to "sX-YYYY-city-hyrox"
  const matches = [...html.matchAll(/\/ranking\/(s\d{1,2}-\d{4}-[a-z-]+)-hyrox-(?:men|women|doubles-(?:men|women|mixed))/gi)];
  const baseMatches = matches.map(m => m[1]).filter(Boolean);

  // Also catch links that end exactly with "-hyrox" (rare)
  const base2 = [...html.matchAll(/\/ranking\/(s\d{1,2}-\d{4}-[a-z-]+)-hyrox(?!-)/gi)].map(m => m[1]);

  const slugs = [...new Set([...baseMatches, ...base2])];
  console.log(`🌍 Found ${slugs.length} event slugs`);
  return slugs;
}

// ───────────────────────────────────────────────────────────
// Build URL list for a set of slugs
// ───────────────────────────────────────────────────────────
function buildUrlsForSlugs(slugs) {
  const urls = [];
  for (const slug of slugs) {
    const baseDefs = buildBaseUrlsForSlug(slug);
    const ags = ageGroupsForSlug(slug);
    for (const def of baseDefs) {
      for (const ag of ags) {
        urls.push({
          url: `${def.url}?ag=${encodeURIComponent(ag)}`,
          slug,
          type: def.type,
          gender: def.gender,
          ag
        });
      }
    }
  }
  return urls;
}

// ───────────────────────────────────────────────────────────
// Scrape driver
// ───────────────────────────────────────────────────────────
async function scrapeBatch(urlDefs) {
  let added = 0;

  for (const def of urlDefs) {
    const { url, slug, type, gender, ag } = def;
    console.log(`🔎 ${url}`);

    const podium = await scrapePodium(url, { type });
    if (!podium) continue;

    const city = cityFromSlug(slug);
    const year = yearFromSlug(slug);

    const eventName = `Ranking of ${year} ${city} HYROX ${type.toUpperCase()} ${gender.toUpperCase()}`;
    const event = {
      key: `${slug}_${ag}_${type}`,
      eventName,
      city,
      year,
      category: ag,
      gender,
      type,
      podium,
      url
    };

    if (uniquePushEvent(event)) {
      added++;
      console.log(`✅ Added ${eventName} (${ag})`);
    } else {
      console.log(`⏩ Skipped cached ${eventName}_${ag}_${type}`);
    }

    // be a good citizen
    await new Promise(r => setTimeout(r, 250));
  }

  console.log(`🎯 Completed scrape — ${added} new events added.`);
  return added;
}

// ───────────────────────────────────────────────────────────
// Routes
// ───────────────────────────────────────────────────────────
app.get("/", (_req, res) => {
  res.send("✅ HYROX Scraper v28.0 — Full Recrawl Edition");
});

app.get("/api/last-run", (_req, res) => {
  if (!fs.existsSync(LAST_RUN_FILE)) return res.status(404).json({ error: "No cache found" });
  return res.sendFile(LAST_RUN_FILE);
});

app.get("/api/clear-cache", (_req, res) => {
  try {
    if (fs.existsSync(LAST_RUN_FILE)) fs.unlinkSync(LAST_RUN_FILE);
    cache = { events: [] };
    return res.json({ status: "cleared" });
  } catch (e) {
    return res.status(500).json({ error: e.message });
  }
});

app.post("/api/set-initial-cache", (req, res) => {
  try {
    const { events } = req.body || {};
    if (!Array.isArray(events)) return res.status(400).json({ error: "Invalid 'events' payload" });

    // Merge uniquely by (eventName, category, type)
    const dedup = new Map(
      cache.events.map(e => [`${e.eventName}_${e.category}_${e.type}`, e])
    );
    events.forEach(e => {
      const key = `${e.eventName}_${e.category}_${e.type}`;
      dedup.set(key, e);
    });
    cache.events = [...dedup.values()];
    saveCache();
    return res.json({ status: "✅ Cache restored", count: cache.events.length });
  } catch (e) {
    return res.status(500).json({ error: e.message });
  }
});

// 👉 Full recrawl of ALL past events (Solo + Doubles; masters AGs)
app.get("/api/scrape-all", async (_req, res) => {
  try {
    const slugs = await discoverPastSlugs();
    const urlDefs = buildUrlsForSlugs(slugs);
    const added = await scrapeBatch(urlDefs);
    res.json({ added, totalCache: cache.events.length });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// 👉 Recrawl only the newest N slugs (default 2). Use for weekend runs.
app.get("/api/scrape-latest", async (req, res) => {
  try {
    const n = Math.max(1, Math.min(10, parseInt(req.query.n || "2", 10)));
    const slugs = await discoverPastSlugs();

    // Take the last N slugs by natural listing order (end of list is newest on hyresult)
    const latest = slugs.slice(-n);
    console.log(`🆕 Using ${latest.length} latest slugs:`, latest);
    const urlDefs = buildUrlsForSlugs(latest);
    const added = await scrapeBatch(urlDefs);
    res.json({ added, totalCache: cache.events.length });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.get("/api/health", (_req, res) => res.json({ ok: true }));

// ───────────────────────────────────────────────────────────
app.listen(PORT, () => console.log(`🔥 HYROX Scraper v28.0 running on port ${PORT}`));
