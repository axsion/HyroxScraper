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
// HYROX master categories
const AGE_GROUPS = ["45-49", "50-54", "55-59", "60-64", "65-69", "70-74", "75-79"];

// FULL URL LIST (S8 + S7)
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

/* -----------------------------------------------------------------------------
   CACHE FUNCTIONS
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

  const browser = await chromium.launch({ headless: true, args: ["--no-sandbox", "--disable-dev-shm-usage"] });
  const page = await browser.newPage();

  try {
    await page.goto(url, { waitUntil: "networkidle", timeout: 45000 });
    const hasTable = await page.$("table");
    if (!hasTable) {
      console.warn(`⚠️ No results table for ${url}`);
      await browser.close();
      return null;
    }

    const rows = await page.$$eval("table tbody tr", trs =>
      trs.slice(0, 3).map(tr => {
        const tds = [...tr.querySelectorAll("td")].map(td => td.innerText.trim());
        return { rank: tds[1] || "", name: tds[3] || "", time: tds[5] || "" };
      })
    );

    if (!rows.length) {
      console.warn(`⚠️ Empty table for ${url}`);
      await browser.close();
      return null;
    }

    const title = await page.title();
    const gender = /women/i.test(baseUrl) ? "Women" : "Men";
    const event = { eventName: title, gender, category: ageGroup, url, podium: rows };

    console.log(`✅ ${title} (${ageGroup}) → ${rows.length} rows`);
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

// Full scrape (skipping cached)
app.get("/api/scrape-batch-save", async (_req, res) => {
  console.log("🚀 Starting scrape batch...");
  const cache = loadCache();

  for (const base of EVENT_URLS) {
    for (const ag of AGE_GROUPS) {
      const full = `${base}?ag=${ag}`;
      if (cache.find(e => e.url === full)) {
        console.log(`⏩ Skipping cached ${full}`);
        continue;
      }

      const result = await scrapeSingle(base, ag);
      if (result) {
        cache.push(result);
        saveCache(cache);
      }
      await new Promise(r => setTimeout(r, 800));
    }
  }

  saveCache(cache);
  res.json({ status: "✅ Complete", count: cache.length });
});

// Only scrape missing URLs
app.get("/api/scrape-missing", async (_req, res) => {
  const cache = loadCache();
  const all = EVENT_URLS.flatMap(b => AGE_GROUPS.map(a => `${b}?ag=${a}`));
  const missing = all.filter(u => !cache.find(e => e.url === u));

  if (!missing.length) return res.json({ status: "up-to-date", count: cache.length });

  console.log(`🚀 Found ${missing.length} missing events.`);
  for (const u of missing) {
    const [b, ag] = u.split("?ag=");
    const r = await scrapeSingle(b, ag);
    if (r) {
      cache.push(r);
      saveCache(cache);
    }
    await new Promise(r => setTimeout(r, 800));
  }

  saveCache(cache);
  res.json({ status: "✅ Added missing", total: cache.length });
});

// Restore cache from Sheet
app.post("/api/set-initial-cache", (req, res) => {
  const { events } = req.body;
  if (!events?.length) return res.status(400).json({ error: "No events provided" });
  fs.writeFileSync(
    LAST_RUN_FILE,
    JSON.stringify({ scrapedAt: new Date().toISOString(), count: events.length, events }, null, 2)
  );
  console.log(`💾 Restored cache with ${events.length} events`);
  res.json({ status: "Cache restored", count: events.length });
});

// Read cache
app.get("/api/last-run", (_req, res) => {
  if (!fs.existsSync(LAST_RUN_FILE)) return res.status(404).json({ error: "No cache" });
  res.sendFile(LAST_RUN_FILE);
});

// Clear cache
app.get("/api/clear-cache", (_req, res) => {
  if (fs.existsSync(LAST_RUN_FILE)) fs.unlinkSync(LAST_RUN_FILE);
  res.json({ status: "cleared" });
});

app.get("/", (_req, res) =>
  res.send("✅ HYROX Scraper v17 (FULL) — persistent, incremental, restart-safe")
);

app.listen(PORT, () => console.log(`✅ Running on port ${PORT}`));
