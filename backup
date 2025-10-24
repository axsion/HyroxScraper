import express from "express";
import fs from "fs";
import path from "path";
import { chromium } from "playwright";

const app = express();
const PORT = process.env.PORT || 10000;

/* -----------------------------------------------------------------------------
   STORAGE / CACHE
----------------------------------------------------------------------------- */
const DATA_DIR = path.join(process.cwd(), "data");
const LAST_RUN_FILE = path.join(DATA_DIR, "last-run.json");
if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });

/* -----------------------------------------------------------------------------
   CONFIG
----------------------------------------------------------------------------- */
// HYROX master age groups (unchanged)
const AGE_GROUPS = ["45-49", "50-54", "55-59", "60-64", "65-69", "70-74", "75-79"];

// Legacy SOLO event URLs you already used (S8 + S7). We’ll *derive* doubles from these.
const EVENT_URLS = [
  // S8
  "https://www.hyresult.com/ranking/s8-2025-valencia-hyrox-men",
  "https://www.hyresult.com/ranking/s8-2025-valencia-hyrox-women",
  "https://www.hyresult.com/ranking/s8-2025-gdansk-hyrox-men",
  "https://www.hyresult.com/ranking/s8-2025-gdansk-hyrox-women",
  "https://www.hyresult.com/ranking/s8-2025-geneva-hyrox-men",
  "https://www.hyresult.com/ranking/s8-2025-geneva-hyrox-women",
  "https://www.hyresult.com/ranking/s8-2025-hamburg-hyrox-men",
  "https://www.hyresult.com/ranking/s8-2025-hamburg-hyrox-women",
  "https://www.hyresult.com/ranking/s8-2025-toronto-hyrox-men",
  "https://www.hyresult.com/ranking/s8-2025-toronto-hyrox-women",
  "https://www.hyresult.com/ranking/s8-2025-oslo-hyrox-men",
  "https://www.hyresult.com/ranking/s8-2025-oslo-hyrox-women",
  "https://www.hyresult.com/ranking/s8-2025-rome-hyrox-men",
  "https://www.hyresult.com/ranking/s8-2025-rome-hyrox-women",
  "https://www.hyresult.com/ranking/s8-2025-boston-hyrox-men",
  "https://www.hyresult.com/ranking/s8-2025-boston-hyrox-women",
  "https://www.hyresult.com/ranking/s8-2025-maastricht-hyrox-men",
  "https://www.hyresult.com/ranking/s8-2025-maastricht-hyrox-women",
  "https://www.hyresult.com/ranking/s8-2025-sao-paulo-hyrox-men",
  "https://www.hyresult.com/ranking/s8-2025-sao-paulo-hyrox-women",
  "https://www.hyresult.com/ranking/s8-2025-acapulco-hyrox-men",
  "https://www.hyresult.com/ranking/s8-2025-acapulco-hyrox-women",
  "https://www.hyresult.com/ranking/s8-2025-perth-hyrox-men",
  "https://www.hyresult.com/ranking/s8-2025-perth-hyrox-women",
  "https://www.hyresult.com/ranking/s8-2025-mumbai-hyrox-men",
  "https://www.hyresult.com/ranking/s8-2025-mumbai-hyrox-women",
  "https://www.hyresult.com/ranking/s8-2025-beijing-hyrox-men",
  "https://www.hyresult.com/ranking/s8-2025-beijing-hyrox-women",
  "https://www.hyresult.com/ranking/s8-2025-yokohama-hyrox-men",
  "https://www.hyresult.com/ranking/s8-2025-yokohama-hyrox-women",
  "https://www.hyresult.com/ranking/s8-2025-hong-kong-hyrox-men",
  "https://www.hyresult.com/ranking/s8-2025-hong-kong-hyrox-women",
  "https://www.hyresult.com/ranking/s8-2025-cape-town-hyrox-men",
  "https://www.hyresult.com/ranking/s8-2025-cape-town-hyrox-women",
  "https://www.hyresult.com/ranking/s8-2025-new-delhi-hyrox-men",
  "https://www.hyresult.com/ranking/s8-2025-new-delhi-hyrox-women",
  "https://www.hyresult.com/ranking/s8-2025-abu-dhabi-hyrox-men",
  "https://www.hyresult.com/ranking/s8-2025-abu-dhabi-hyrox-women",
  "https://www.hyresult.com/ranking/s8-2025-sydney-hyrox-men",
  "https://www.hyresult.com/ranking/s8-2025-sydney-hyrox-women",
  "https://www.hyresult.com/ranking/s8-2025-singapore-hyrox-men",
  "https://www.hyresult.com/ranking/s8-2025-singapore-hyrox-women",
  // S7
  "https://www.hyresult.com/ranking/s7-2025-new-york-hyrox-men",
  "https://www.hyresult.com/ranking/s7-2025-new-york-hyrox-women",
  "https://www.hyresult.com/ranking/s7-2025-rimini-hyrox-men",
  "https://www.hyresult.com/ranking/s7-2025-rimini-hyrox-women",
  "https://www.hyresult.com/ranking/s7-2025-cardiff-hyrox-men",
  "https://www.hyresult.com/ranking/s7-2025-cardiff-hyrox-women",
  "https://www.hyresult.com/ranking/s7-2025-riga-hyrox-men",
  "https://www.hyresult.com/ranking/s7-2025-riga-hyrox-women",
  "https://www.hyresult.com/ranking/s7-2025-bangkok-hyrox-men",
  "https://www.hyresult.com/ranking/s7-2025-bangkok-hyrox-women",
  "https://www.hyresult.com/ranking/s7-2025-berlin-hyrox-men",
  "https://www.hyresult.com/ranking/s7-2025-berlin-hyrox-women",
  "https://www.hyresult.com/ranking/s7-2025-incheon-hyrox-men",
  "https://www.hyresult.com/ranking/s7-2025-incheon-hyrox-women",
  "https://www.hyresult.com/ranking/s7-2025-heerenveen-hyrox-men",
  "https://www.hyresult.com/ranking/s7-2025-heerenveen-hyrox-women"
];

// Utility: from the solo URLs, build a unique set of base event slugs like "s8-2025-valencia-hyrox"
function getBaseEventSlugs(urls) {
  const bases = new Set(
    urls.map(u => u.replace(/-(men|women)$/i, "")).map(u => u.trim())
  );
  return Array.from(bases);
}

// Build doubles URLs (men/women/mixed) from base slugs
function buildDoublesUrlsFromBases(bases) {
  const genders = ["men", "women", "mixed"];
  const doubles = [];
  for (const base of bases) {
    for (const g of genders) {
      doubles.push(`${base}-doubles-${g}`);
    }
  }
  return doubles;
}

// Build URL set based on year + type, preserving backwards compatibility
function buildUrlSet({ year = "2025", type = "double" }) {
  const bases = getBaseEventSlugs(
    EVENT_URLS.filter(u => u.includes(`-${year}-`))
  );
  if (type === "double") return buildDoublesUrlsFromBases(bases);
  if (type === "solo") return EVENT_URLS.filter(u => u.includes(`-${year}-`));
  // type === "all"
  return [
    ...EVENT_URLS.filter(u => u.includes(`-${year}-`)),
    ...buildDoublesUrlsFromBases(bases),
  ];
}

/* -----------------------------------------------------------------------------
   CACHE HELPERS
----------------------------------------------------------------------------- */
function loadCache() {
  if (!fs.existsSync(LAST_RUN_FILE)) return [];
  try {
    return JSON.parse(fs.readFileSync(LAST_RUN_FILE, "utf8")).events || [];
  } catch {
    return [];
  }
}

function saveCache(events) {
  fs.writeFileSync(
    LAST_RUN_FILE,
    JSON.stringify(
      { scrapedAt: new Date().toISOString(), count: events.length, events },
      null,
      2
    )
  );
  console.log(`💾 Saved checkpoint (${events.length} total events)`);
}

/* -----------------------------------------------------------------------------
   SCRAPER
----------------------------------------------------------------------------- */
async function scrapeSingle(baseUrl, ageGroup) {
  const url = `${baseUrl}?ag=${ageGroup}`;
  console.log(`🔎 Scraping ${url}`);

  const browser = await chromium.launch({
    headless: true,
    args: ["--no-sandbox", "--disable-dev-shm-usage"],
  });
  const page = await browser.newPage();

  try {
    await page.goto(url, { waitUntil: "networkidle", timeout: 60000 });

    const hasTable = await page.$("table");
    if (!hasTable) {
      console.warn(`⚠️ No results table for ${url}`);
      await browser.close();
      return null;
    }

    // Top-3 podium rows (rank, name, time); handle solo or double names.
    const rows = await page.$$eval("table tbody tr", (trs) =>
      trs.slice(0, 3).map((tr) => {
        const tds = Array.from(tr.querySelectorAll("td")).map((td) =>
          td.innerText.trim()
        );
        // Fallback-safe indexing (some tables shift columns)
        const rank =
          tds[0] && /^\d+$/.test(tds[0]) ? tds[0] : (tds[1] || "").trim();
        const nameCell =
          tds[3] ??
          tds[2] ??
          tds.find((c) => c && c.length > 0) ??
          "";
        const timeCell =
          tds[5] ??
          tds[4] ??
          tds[tds.length - 1] ??
          "";

        // Normalize double names: join with ' & '
        const normalizedName = nameCell
          .split(/\r?\n|\/| & | and /i)
          .map((s) => s.trim())
          .filter(Boolean)
          .join(" & ");

        return { rank: rank || "", name: normalizedName || "", time: timeCell || "" };
      })
    );

    if (!rows.length || !rows[0].time) {
      console.warn(`⚠️ Empty podium for ${url}`);
      await browser.close();
      return null;
    }

    const title = (await page.title()) || "";
    const gender = /doubles-men/i.test(baseUrl)
      ? "Men"
      : /doubles-women/i.test(baseUrl)
      ? "Women"
      : /doubles-mixed/i.test(baseUrl)
      ? "Mixed"
      : /women/i.test(baseUrl)
      ? "Women"
      : "Men";

    const type = /-doubles-/i.test(baseUrl) ? "Double" : "Solo";
    const mYear = baseUrl.match(/-(\d{4})-/);
    const year = mYear ? mYear[1] : "";

    const event = {
      eventName: title, // e.g., "Ranking of 2025 Valencia HYROX MEN"
      gender,
      type,
      year,
      category: ageGroup, // age group
      url,
      podium: rows, // [{rank, name, time}, ...3]
    };

    console.log(`✅ ${title} (${ageGroup}, ${type}) → ${rows.length} rows`);
    await browser.close();
    return event;
  } catch (err) {
    console.error(`❌ Error scraping ${url}: ${err.message}`);
    await browser.close();
    return null;
  }
}

/* -----------------------------------------------------------------------------
   ROUTES
----------------------------------------------------------------------------- */
app.use(express.json());

/**
 * Full scrape with persistent checkpoints.
 * Query params:
 *   - year=2025|2026 (default 2025)
 *   - type=double|solo|all (default 'double' to avoid re-scraping 2025 solo)
 */
app.get("/api/scrape-batch-save", async (req, res) => {
  const year = (req.query.year || "2025").toString();
  const type = (req.query.type || "double").toString();

  console.log(`🚀 Starting scrape batch… year=${year} type=${type}`);
  const cache = loadCache();
  const targets = buildUrlSet({ year, type });

  for (const base of targets) {
    for (const ag of AGE_GROUPS) {
      const full = `${base}?ag=${ag}`;
      if (cache.find((e) => e.url === full)) {
        console.log(`⏩ Skipping cached ${full}`);
        continue;
      }
      const result = await scrapeSingle(base, ag);
      if (result) {
        cache.push(result);
        saveCache(cache);
      }
      await new Promise((r) => setTimeout(r, 800));
    }
  }

  saveCache(cache);
  res.json({ status: "✅ Complete", count: cache.length, year, type });
});

/**
 * Only scrape missing URLs (incremental).
 * Same query params as above.
 */
app.get("/api/scrape-missing", async (req, res) => {
  const year = (req.query.year || "2025").toString();
  const type = (req.query.type || "double").toString();

  const cache = loadCache();
  const targets = buildUrlSet({ year, type });
  const all = targets.flatMap((b) => AGE_GROUPS.map((a) => `${b}?ag=${a}`));
  const missing = all.filter((u) => !cache.find((e) => e.url === u));

  if (!missing.length)
    return res.json({ status: "up-to-date", count: cache.length, year, type });

  console.log(`🚀 Found ${missing.length} missing events (year=${year}, type=${type}).`);
  for (const u of missing) {
    const [b, ag] = u.split("?ag=");
    const r = await scrapeSingle(b, ag);
    if (r) {
      cache.push(r);
      saveCache(cache);
    }
    await new Promise((r) => setTimeout(r, 800));
  }

  saveCache(cache);
  res.json({ status: "✅ Added missing", total: cache.length, year, type });
});

// Restore cache from Sheet (unchanged)
app.post("/api/set-initial-cache", (req, res) => {
  const { events } = req.body;
  if (!events?.length) return res.status(400).json({ error: "No events provided" });
  fs.writeFileSync(
    LAST_RUN_FILE,
    JSON.stringify(
      { scrapedAt: new Date().toISOString(), count: events.length, events },
      null,
      2
    )
  );
  console.log(`💾 Restored cache with ${events.length} events`);
  res.json({ status: "Cache restored", count: events.length });
});

// Read cache (unchanged)
app.get("/api/last-run", (_req, res) => {
  if (!fs.existsSync(LAST_RUN_FILE)) return res.status(404).json({ error: "No cache" });
  res.sendFile(LAST_RUN_FILE);
});

// Clear cache (unchanged)
app.get("/api/clear-cache", (_req, res) => {
  if (fs.existsSync(LAST_RUN_FILE)) fs.unlinkSync(LAST_RUN_FILE);
  res.json({ status: "cleared" });
});

app.get("/", (_req, res) =>
  res.send("✅ HYROX Scraper v18 — Solo+Double ready, persistent, incremental, restart-safe")
);

app.listen(PORT, () => console.log(`✅ Running on port ${PORT}`));
