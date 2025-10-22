import express from "express";
import fs from "fs";
import path from "path";
import { chromium } from "playwright";

const app = express();
const PORT = process.env.PORT || 10000;

// -----------------------------------------------------------------------------
// 📁 Paths
// -----------------------------------------------------------------------------
const dataDir = path.join(process.cwd(), "data");
const listFile = path.join(dataDir, "events-list.json");
const resultFile = path.join(dataDir, "last-run.json");
if (!fs.existsSync(dataDir)) fs.mkdirSync(dataDir, { recursive: true });

// -----------------------------------------------------------------------------
// 🧾 Logging helper
// -----------------------------------------------------------------------------
const logWrap = (logs, msg) => {
  const line = `${new Date().toISOString().split("T")[1].split(".")[0]} - ${msg}`;
  console.log(line);
  logs.push(line);
};

// -----------------------------------------------------------------------------
// 🩺 Health Check
// -----------------------------------------------------------------------------
app.get("/api/health", (_, res) => res.json({ ok: true }));

// -----------------------------------------------------------------------------
// 🧭 STEP 1 – Collect all event URLs
// -----------------------------------------------------------------------------
app.get("/api/scrape-event-list", async (_, res) => {
  let browser;
  const logs = [];

  try {
    logWrap(logs, "🚀 Launching browser...");
    browser = await chromium.launch({ headless: true });
    const page = await browser.newPage();
    await page.setViewportSize({ width: 1400, height: 900 });

    logWrap(logs, "🔍 Visiting past events page...");
    await page.goto("https://www.hyresult.com/events?tab=past", {
      waitUntil: "domcontentloaded",
      timeout: 0
    });

    logWrap(logs, "⬇️ Scrolling until all events are loaded...");
    await page.evaluate(async () => {
      const sleep = ms => new Promise(r => setTimeout(r, ms));
      let prev = 0;
      for (let i = 0; i < 30; i++) {
        window.scrollTo(0, document.body.scrollHeight);
        await sleep(1000);
        const height = document.body.scrollHeight;
        if (height === prev) break;
        prev = height;
      }
    });

    const events = await page.evaluate(() => {
      const anchors = Array.from(document.querySelectorAll("a[href*='/ranking/']"));
      const seen = new Set();
      return anchors
        .map(a => ({
          name: a.textContent.trim(),
          href: a.href
        }))
        .filter(e => e.name && e.href && !seen.has(e.href) && seen.add(e.href));
    });

    if (!events.length) throw new Error("No ranking links found.");
    fs.writeFileSync(listFile, JSON.stringify(events, null, 2));
    logWrap(logs, `💾 Saved ${events.length} events to ${listFile}`);

    res.json({ ok: true, count: events.length, events, log: logs });
  } catch (err) {
    logWrap(logs, `❌ Error: ${err.message}`);
    res.status(500).json({ error: err.message, log: logs });
  } finally {
    if (browser) await browser.close();
  }
});

// -----------------------------------------------------------------------------
// 🏁 STEP 2 – Scrape podiums (append-only)
// -----------------------------------------------------------------------------
app.get("/api/scrape-from-list", async (_, res) => {
  if (!fs.existsSync(listFile))
    return res.status(404).json({ error: "Run /api/scrape-event-list first." });

  const allEvents = JSON.parse(fs.readFileSync(listFile, "utf8"));

  // Load previous results if they exist
  let previousData = { events: [] };
  if (fs.existsSync(resultFile)) {
    previousData = JSON.parse(fs.readFileSync(resultFile, "utf8"));
  }
  const existingUrls = new Set(previousData.events.map(e => e.url));

  // Filter only new events
  const newEvents = allEvents.filter(ev => !existingUrls.has(ev.href));
  const logs = [];
  const results = [...previousData.events]; // start with existing data
  let browser;

  try {
    if (!newEvents.length) {
      logWrap(logs, "✅ No new events to scrape. Dataset already up-to-date.");
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

    // Save merged dataset
    const output = { date: new Date().toISOString(), events: results };
    fs.writeFileSync(resultFile, JSON.stringify(output, null, 2));
    logWrap(logs, `💾 Saved updated dataset with ${results.length} total events`);

    res.json({ ok: true, newCount: newEvents.length, total: results.length, log: logs });
  } catch (err) {
    logWrap(logs, `❌ Fatal: ${err.message}`);
    res.status(500).json({ error: err.message, log: logs });
  } finally {
    if (browser) await browser.close();
  }
});

// -----------------------------------------------------------------------------
// 📂 View saved data
// -----------------------------------------------------------------------------
app.get("/api/event-list", (_, res) => {
  if (!fs.existsSync(listFile)) return res.status(404).json({ error: "No events-list found" });
  res.json(JSON.parse(fs.readFileSync(listFile, "utf8")));
});

app.get("/api/last-run", (_, res) => {
  if (!fs.existsSync(resultFile)) return res.status(404).json({ error: "No last-run data found" });
  res.json(JSON.parse(fs.readFileSync(resultFile, "utf8")));
});

// -----------------------------------------------------------------------------
// 🚀 Start server
// -----------------------------------------------------------------------------
app.listen(PORT, () => console.log(`✅ HYROX hybrid scraper (append-only) running on port ${PORT}`));
