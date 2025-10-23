import express from "express";
import fs from "fs";
import path from "path";
import { chromium } from "playwright";

const app = express();
const PORT = process.env.PORT || 10000;

// -----------------------------------------------------------------------------
// CONFIG
// -----------------------------------------------------------------------------
const DATA_DIR = path.join(process.cwd(), "data");
const LAST_RUN_FILE = path.join(DATA_DIR, "last-run.json");
if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });

const AGE_GROUPS = ["45-49", "50-54", "55-59", "60-64", "65-69", "70-74", "75-79"];

const EVENT_URLS = [
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
  "https://www.hyresult.com/ranking/s8-2025-boston-hyrox-men",
  "https://www.hyresult.com/ranking/s8-2025-boston-hyrox-women"
];

// -----------------------------------------------------------------------------
// HELPERS
// -----------------------------------------------------------------------------
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

async function scrapeSingle(baseUrl, ageGroup) {
  const url = `${baseUrl}?ag=${ageGroup}`;
  console.log(`🔎 Scraping ${url}`);
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();

  try {
    await page.goto(url, { waitUntil: "networkidle", timeout: 45000 });
    const hasTable = await page.$("table");
    if (!hasTable) {
      console.warn(`⚠️ No table for ${url}`);
      await browser.close();
      return null;
    }

    const rows = await page.$$eval("table tbody tr", trs =>
      trs.slice(0, 3).map(tr => {
        const tds = [...tr.querySelectorAll("td")].map(td => td.innerText.trim());
        return { rank: tds[1] || "", name: tds[3] || "", time: tds[5] || "" };
      })
    );

    if (rows.length === 0) {
      console.warn(`⚠️ Empty table for ${url}`);
      await browser.close();
      return null;
    }

    const title = await page.title();
    const gender = baseUrl.includes("women") ? "Women" : "Men";
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

// -----------------------------------------------------------------------------
// ROUTES
// -----------------------------------------------------------------------------
app.use(express.json());

// Full scrape with skip logic
app.get("/api/scrape-batch-save", async (req, res) => {
  console.log("🚀 Starting full scrape...");
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
  res.json({ status: "✅ Full batch complete", count: cache.length });
});

// Only scrape missing ones
app.get("/api/scrape-missing", async (req, res) => {
  console.log("🔎 Searching for missing events...");
  const cache = loadCache();
  const allTargets = EVENT_URLS.flatMap(base => AGE_GROUPS.map(ag => `${base}?ag=${ag}`));
  const missing = allTargets.filter(url => !cache.find(e => e.url === url));

  if (missing.length === 0) {
    console.log("✅ No missing events to scrape.");
    return res.json({ status: "up-to-date", count: cache.length });
  }

  console.log(`🚀 Found ${missing.length} missing events — scraping them...`);
  for (const target of missing) {
    const [base, query] = target.split("?ag=");
    const result = await scrapeSingle(base, query);
    if (result) {
      cache.push(result);
      saveCache(cache);
    }
    await new Promise(r => setTimeout(r, 800));
  }

  saveCache(cache);
  res.json({ status: "✅ Missing events scraped", newAdded: missing.length, total: cache.length });
});

// Restore cache from Google Sheet
app.post("/api/set-initial-cache", (req, res) => {
  const { events } = req.body;
  if (!events || !Array.isArray(events)) {
    return res.status(400).json({ error: "Invalid or missing 'events' array" });
  }
  fs.writeFileSync(
    LAST_RUN_FILE,
    JSON.stringify(
      {
        scrapedAt: new Date().toISOString(),
        count: events.length,
        events: events.map(e => ({
          eventName: e.eventName,
          gender: e.gender,
          category: e.category,
          url: e.url,
          podium: e.podium || []
        }))
      },
      null,
      2
    )
  );
  console.log(`💾 Initial cache restored with ${events.length} events`);
  res.json({ status: "Cache restored", count: events.length });
});

// Clear cache manually
app.get("/api/clear-cache", (req, res) => {
  if (fs.existsSync(LAST_RUN_FILE)) fs.unlinkSync(LAST_RUN_FILE);
  res.json({ status: "Cache cleared" });
});

// Return cache
app.get("/api/last-run", (req, res) => {
  if (!fs.existsSync(LAST_RUN_FILE))
    return res.status(404).json({ error: "No last-run data found" });
  res.sendFile(LAST_RUN_FILE);
});

app.get("/", (_, res) =>
  res.send("✅ HYROX Scraper v16 — persistent via Google Sheet cache restore")
);

app.listen(PORT, () => console.log(`✅ Server ready on port ${PORT}`));
