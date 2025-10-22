import express from "express";
import fs from "fs";
import path from "path";
import { chromium } from "playwright";

const app = express();
const PORT = process.env.PORT || 10000;

// Create data folder for storing runs
const dataDir = path.join(process.cwd(), "data");
const listFile = path.join(dataDir, "events-list.json");
const resultFile = path.join(dataDir, "last-run.json");
if (!fs.existsSync(dataDir)) fs.mkdirSync(dataDir, { recursive: true });

// Simple logger helper
const logWrap = (logs, msg) => {
  const line = `${new Date().toISOString().split("T")[1].split(".")[0]} - ${msg}`;
  console.log(line);
  logs.push(line);
};

// --- Health check
app.get("/api/health", (_, res) => res.json({ ok: true }));

// =========================================================
// STEP 1: Extract all HYROX event URLs from the “past events” page
// =========================================================
app.get("/api/scrape-event-list", async (_, res) => {
  let browser;
  const logs = [];

  try {
    logWrap(logs, "🚀 Launching browser...");
    browser = await chromium.launch({ headless: true });
    const page = await browser.newPage();
    await page.setViewportSize({ width: 1400, height: 900 });

    logWrap(logs, "🔍 Visiting HYROX past events...");
    await page.goto("https://www.hyresult.com/events?tab=past", {
      waitUntil: "domcontentloaded",
      timeout: 0
    });

    // Scroll progressively to load all React content
    logWrap(logs, "⬇️ Scrolling until all events are loaded...");
    await page.evaluate(async () => {
      const sleep = ms => new Promise(r => setTimeout(r, ms));
      for (let i = 0; i < 25; i++) {
        window.scrollTo(0, document.body.scrollHeight);
        await sleep(1000);
      }
    });

    // Wait for any ranking links to appear
    await page.waitForFunction(() => {
      const anchors = Array.from(document.querySelectorAll("a[href*='/ranking/']"));
      return anchors.length > 0;
    }, { timeout: 60000 });

    // Extract all event URLs
    const list = await page.evaluate(() => {
      const seen = new Set();
      const anchors = Array.from(document.querySelectorAll("a[href*='/ranking/']"));
      return anchors
        .map(a => ({
          name: a.textContent.trim(),
          href: a.href
        }))
        .filter(e => e.name && e.href && !seen.has(e.href) && seen.add(e.href));
    });

    if (!list.length) throw new Error("No ranking links found on page after hydration.");

    // Save locally
    fs.writeFileSync(listFile, JSON.stringify(list, null, 2));
    logWrap(logs, `💾 Saved ${list.length} events to ${listFile}`);

    res.json({ ok: true, count: list.length, events: list, log: logs });
  } catch (err) {
    logWrap(logs, `❌ Fatal: ${err.message}`);
    res.status(500).json({ error: err.message, log: logs });
  } finally {
    if (browser) await browser.close();
  }
});

// =========================================================
// STEP 2: Scrape podium results for all (or new) events
// =========================================================
app.get("/api/scrape-from-list", async (_, res) => {
  if (!fs.existsSync(listFile)) {
    return res.status(404).json({ error: "Run /api/scrape-event-list first." });
  }

  const allEvents = JSON.parse(fs.readFileSync(listFile, "utf8"));
  let previousData = { events: [] };
  if (fs.existsSync(resultFile)) {
    previousData = JSON.parse(fs.readFileSync(resultFile, "utf8"));
  }

  const existingUrls = new Set(previousData.events.map(e => e.url));
  const newEvents = allEvents.filter(ev => !existingUrls.has(ev.href));

  const logs = [];
  const results = [...previousData.events];
  let browser;

  try {
    if (!newEvents.length) {
      logWrap(logs, "✅ No new events to scrape. Already up-to-date.");
      return res.json({ ok: true, message: "No new events", log: logs });
    }

    logWrap(logs, `🚀 Launching browser for ${newEvents.length} new events...`);
    browser = await chromium.launch({ headless: true });

    for (const [i, ev] of newEvents.entries()) {
      try {
        const page = await browser.newPage();
        logWrap(logs, `(${i + 1}/${newEvents.length}) 🏁 Scraping ${ev.name}`);
        await page.goto(ev.href, { waitUntil: "domcontentloaded", timeout: 0 });
        await page.waitForSelector("table tbody tr", { timeout: 20000 });

        const podium = await page.evaluate(() => {
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

        results.push({ event: ev.name, url: ev.href, podium });
        await page.close();
      } catch (e) {
        logWrap(logs, `⚠️ Failed ${ev.name}: ${e.message}`);
      }
    }

    fs.writeFileSync(
      resultFile,
      JSON.stringify({ date: new Date().toISOString(), events: results }, null, 2)
    );

    logWrap(logs, `💾 Updated dataset with ${results.length} total events`);
    res.json({ ok: true, newCount: newEvents.length, total: results.length, log: logs });
  } catch (err) {
    logWrap(logs, `❌ Fatal: ${err.message}`);
    res.status(500).json({ error: err.message, log: logs });
  } finally {
    if (browser) await browser.close();
  }
});

// =========================================================
// STEP 3: View stored data
// =========================================================
app.get("/api/event-list", (_, res) => {
  if (!fs.existsSync(listFile)) {
    return res.status(404).json({ error: "No events-list found" });
  }
  res.json(JSON.parse(fs.readFileSync(listFile, "utf8")));
});

app.get("/api/last-run", (_, res) => {
  if (!fs.existsSync(resultFile)) {
    return res.status(404).json({ error: "No last-run data found" });
  }
  res.json(JSON.parse(fs.readFileSync(resultFile, "utf8")));
});

// =========================================================
// STEP 4: Fallback single race scraper (useful for testing)
// =========================================================
app.get("/api/scrape", async (req, res) => {
  const eventUrl = req.query.url;
  if (!eventUrl) return res.status(400).json({ error: "Missing ?url parameter" });

  let browser;
  const logs = [];

  try {
    logWrap(logs, "🚀 Launching Playwright...");
    browser = await chromium.launch({ headless: true });
    const page = await browser.newPage();

    logWrap(logs, `🔍 Opening ${eventUrl}`);
    await page.goto(eventUrl, { waitUntil: "domcontentloaded", timeout: 0 });
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

    res.json({ eventName, podium: athletes, log: logs });
  } catch (err) {
    logWrap(logs, `❌ Scrape error: ${err.message}`);
    res.status(500).json({ error: err.message, log: logs });
  } finally {
    if (browser) await browser.close();
  }
});

// =========================================================
// Server startup
// =========================================================
app.listen(PORT, () =>
  console.log(`✅ HYROX Season Scraper running on port ${PORT}`)
);
