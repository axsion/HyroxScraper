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

const AGE_GROUPS = ["45-49", "50-54", "55-59", "60-64", "65-69", "70-74", "75-79"];

const EVENT_URLS = [
  "https://www.hyresult.com/ranking/s8-2025-valencia-hyrox-men",
  "https://www.hyresult.com/ranking/s8-2025-valencia-hyrox-women",
  "https://www.hyresult.com/ranking/s8-2025-gdansk-hyrox-men",
  "https://www.hyresult.com/ranking/s8-2025-gdansk-hyrox-women",
  "https://www.hyresult.com/ranking/s8-2025-geneva-hyrox-men",
  "https://www.hyresult.com/ranking/s8-2025-geneva-hyrox-women",
  "https://www.hyresult.com/ranking/s8-2025-toronto-hyrox-men",
  "https://www.hyresult.com/ranking/s8-2025-toronto-hyrox-women",
];

// ensure data directory
if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });

// helper to save incremental results safely
function saveCheckpoint(allResults) {
  try {
    fs.writeFileSync(
      LAST_RUN_FILE,
      JSON.stringify(
        {
          scrapedAt: new Date().toISOString(),
          count: allResults.length,
          events: allResults,
        },
        null,
        2
      )
    );
    console.log(`💾 Saved checkpoint (${allResults.length} events)`);
  } catch (err) {
    console.error("❌ Error saving checkpoint:", err);
  }
}

// helper to load previous cache
function loadPrevious() {
  if (!fs.existsSync(LAST_RUN_FILE)) return [];
  try {
    const data = JSON.parse(fs.readFileSync(LAST_RUN_FILE, "utf8"));
    return data.events || [];
  } catch {
    return [];
  }
}

// -----------------------------------------------------------------------------
// SCRAPER
// -----------------------------------------------------------------------------
async function scrapeSingle(page, baseUrl, ageGroup) {
  const url = `${baseUrl}?ag=${ageGroup}`;
  console.log(`🔎 Visiting ${url}`);

  try {
    await page.goto(url, { waitUntil: "networkidle", timeout: 60000 });
    const hasTable = await page.$("table");
    if (!hasTable) {
      console.warn(`⚠️ No table for ${url}`);
      return null;
    }

    const rows = await page.$$eval("table tbody tr", trs =>
      trs.slice(0, 3).map(tr => {
        const cells = [...tr.querySelectorAll("td")].map(td => td.innerText.trim());
        return {
          rank: cells[1] || "",
          name: cells[3] || "",
          time: cells[5] || "",
        };
      })
    );

    if (rows.length === 0) {
      console.warn(`⚠️ Empty table at ${url}`);
      return null;
    }

    const eventName = await page.title();
    const gender = baseUrl.includes("women") ? "Women" : "Men";
    const entry = {
      eventName,
      gender,
      category: ageGroup,
      url,
      podium: rows,
    };

    console.log(`✅ ${eventName} (${ageGroup}) → ${rows.length} rows`);
    return entry;
  } catch (err) {
    console.error(`❌ Error scraping ${url}: ${err.message}`);
    return null;
  }
}

// -----------------------------------------------------------------------------
// API ENDPOINTS
// -----------------------------------------------------------------------------
app.get("/api/scrape-batch-save", async (req, res) => {
  console.log("🚀 Starting background SAVE batch...");
  const allResults = loadPrevious();

  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();

  for (const baseUrl of EVENT_URLS) {
    for (const ag of AGE_GROUPS) {
      const existing = allResults.find(
        e => e.url === `${baseUrl}?ag=${ag}`
      );
      if (existing) {
        console.log(`⏩ Skipping already scraped ${baseUrl}?ag=${ag}`);
        continue;
      }

      const result = await scrapeSingle(page, baseUrl, ag);
      if (result) {
        allResults.push(result);
        saveCheckpoint(allResults);
      }
    }
  }

  await browser.close();
  saveCheckpoint(allResults);
  res.json({ status: "✅ Batch complete", count: allResults.length });
});

app.get("/api/last-run", (req, res) => {
  if (!fs.existsSync(LAST_RUN_FILE))
    return res.status(404).json({ error: "No last-run data found" });
  const data = JSON.parse(fs.readFileSync(LAST_RUN_FILE, "utf8"));
  res.json(data);
});

app.get("/", (req, res) => {
  res.send("✅ HYROX Scraper v15A — stream-to-disk mode");
});

app.listen(PORT, () =>
  console.log(`✅ HYROX Scraper v15A running on port ${PORT}`)
);
