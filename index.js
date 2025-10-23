import express from "express";
import fs from "fs";
import path from "path";
import { chromium } from "playwright";

const app = express();
const PORT = process.env.PORT || 10000;

// === Local data folder ===
const dataDir = path.join(process.cwd(), "data");
const resultFile = path.join(dataDir, "last-run.json");
if (!fs.existsSync(dataDir)) fs.mkdirSync(dataDir, { recursive: true });

// === Static list of base events ===
// (NO "-men" or "-women" here — script adds those automatically)
const baseEvents = [
  "https://www.hyresult.com/ranking/s8-2025-valencia-hyrox",
  "https://www.hyresult.com/ranking/s8-2025-gdansk-hyrox",
  "https://www.hyresult.com/ranking/s8-2025-geneva-hyrox",
  "https://www.hyresult.com/ranking/s8-2025-hamburg-hyrox",
  "https://www.hyresult.com/ranking/s8-2025-toronto-hyrox",
  "https://www.hyresult.com/ranking/s8-2025-oslo-hyrox",
  "https://www.hyresult.com/ranking/s8-2025-rome-hyrox",
  "https://www.hyresult.com/ranking/s8-2025-boston-hyrox",
  "https://www.hyresult.com/ranking/s8-2025-maastricht-hyrox",
  "https://www.hyresult.com/ranking/s8-2025-sao-paulo-hyrox",
  "https://www.hyresult.com/ranking/s8-2025-acapulco-hyrox",
  "https://www.hyresult.com/ranking/s8-2025-perth-hyrox",
  "https://www.hyresult.com/ranking/s8-2025-mumbai-hyrox",
  "https://www.hyresult.com/ranking/s8-2025-beijing-hyrox",
  "https://www.hyresult.com/ranking/s8-2025-yokohama-hyrox",
  "https://www.hyresult.com/ranking/s8-2025-hong-kong-hyrox",
  "https://www.hyresult.com/ranking/s8-2025-cape-town-hyrox",
  "https://www.hyresult.com/ranking/s8-2025-new-delhi-hyrox",
  "https://www.hyresult.com/ranking/s8-2025-abu-dhabi-hyrox",
  "https://www.hyresult.com/ranking/s8-2025-sydney-hyrox",
  "https://www.hyresult.com/ranking/s8-2025-singapore-hyrox",
  "https://www.hyresult.com/ranking/s7-2025-new-york-hyrox",
  "https://www.hyresult.com/ranking/s7-2025-rimini-hyrox",
  "https://www.hyresult.com/ranking/s7-2025-cardiff-hyrox",
  "https://www.hyresult.com/ranking/s7-2025-riga-hyrox",
  "https://www.hyresult.com/ranking/s7-2025-bangkok-hyrox",
  "https://www.hyresult.com/ranking/s7-2025-berlin-hyrox",
  "https://www.hyresult.com/ranking/s7-2025-incheon-hyrox",
  "https://www.hyresult.com/ranking/s7-2025-heerenveen-hyrox"
];

// === Logger helper ===
const log = (logs, msg) => {
  const line = `${new Date().toISOString().split("T")[1].split(".")[0]} - ${msg}`;
  console.log(line);
  logs.push(line);
};

// === Health check ===
app.get("/api/health", (_, res) => res.json({ ok: true }));

// === Scraper ===
app.get("/api/scrape-all", async (req, res) => {
  const logs = [];
  let browser;
  const limit = req.query.limit ? parseInt(req.query.limit) : baseEvents.length;

  try {
    log(logs, "🚀 Launching Playwright...");
    browser = await chromium.launch({ headless: true });
    const page = await browser.newPage();

    // Load previous run data if available
    let previousData = { events: [] };
    if (fs.existsSync(resultFile)) {
      previousData = JSON.parse(fs.readFileSync(resultFile, "utf8"));
    }
    const existingUrls = new Set(previousData.events.map(e => e.url));

    // Build new list (both genders)
    const fullUrls = baseEvents.flatMap(base => [
      { gender: "men", url: `${base}-men` },
      { gender: "women", url: `${base}-women` }
    ]);

    const newUrls = fullUrls.filter(e => !existingUrls.has(e.url)).slice(0, limit);

    if (!newUrls.length) {
      log(logs, "✅ No new events — already up-to-date.");
      return res.json({ ok: true, message: "No new events", log: logs });
    }

    log(logs, `📅 Found ${newUrls.length} new events to scrape.`);

    for (const [i, ev] of newUrls.entries()) {
      try {
        log(logs, `(${i + 1}/${newUrls.length}) 🏁 Scraping ${ev.url}`);
        await page.goto(ev.url, { waitUntil: "domcontentloaded", timeout: 0 });
        await page.waitForSelector("table tbody tr", { timeout: 20000 });

        const eventName = await page.title();
        const athletes = await page.evaluate(() => {
          const rows = Array.from(document.querySelectorAll("table tbody tr"));
          return rows.slice(0, 3).map(row => {
            const cells = row.querySelectorAll("td");
            return {
              rank: cells[1]?.innerText.trim(),
              name: cells[3]?.innerText.trim(),
              ageGroup: cells[4]?.innerText.trim(),
              time: cells[5]?.innerText.trim()
            };
          });
        });

        previousData.events.push({
          eventName,
          gender: ev.gender,
          url: ev.url,
          podium: athletes
        });
      } catch (err) {
        log(logs, `⚠️ Failed ${ev.url}: ${err.message}`);
      }
    }

    fs.writeFileSync(resultFile, JSON.stringify(previousData, null, 2));
    log(logs, `💾 Saved ${previousData.events.length} events total`);

    res.json({
      ok: true,
      total: previousData.events.length,
      scrapedNow: newUrls.length,
      log
    });
  } catch (err) {
    log(logs, `❌ Fatal error: ${err.message}`);
    res.status(500).json({ error: err.message, log: logs });
  } finally {
    if (browser) await browser.close();
  }
});

// === View stored data ===
app.get("/api/last-run", (_, res) => {
  if (!fs.existsSync(resultFile)) {
    return res.status(404).json({ error: "No previous run found" });
  }
  const data = JSON.parse(fs.readFileSync(resultFile, "utf8"));
  res.json(data);
});

// === Start server ===
app.listen(PORT, () =>
  console.log(`✅ HYROX Dual-Gender Scraper running on port ${PORT}`)
);
