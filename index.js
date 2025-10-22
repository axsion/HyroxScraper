import express from "express";
import fs from "fs";
import path from "path";
import { chromium } from "playwright";

const app = express();
const PORT = process.env.PORT || 10000;

const dataDir = path.join(process.cwd(), "data");
const dataFile = path.join(dataDir, "last-run.json");
if (!fs.existsSync(dataDir)) fs.mkdirSync(dataDir);

process.on("unhandledRejection", err => console.error("🚨 Unhandled Rejection:", err));

app.get("/api/health", (_, res) => res.json({ ok: true }));

// -----------------------------
// 🏁 SCRAPE INDIVIDUAL EVENT
// -----------------------------
app.get("/api/scrape", async (req, res) => {
  const eventUrl = req.query.url;
  if (!eventUrl) return res.status(400).json({ error: "Missing ?url parameter" });

  let browser;
  const logs = [];
  const log = msg => {
    console.log(msg);
    logs.push(`${new Date().toISOString().split("T")[1].split(".")[0]} - ${msg}`);
  };

  try {
    log("🚀 Launching browser...");
    browser = await chromium.launch({ headless: true });
    const page = await browser.newPage();
    log(`🔍 Opening ${eventUrl}`);

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
    log(`❌ Error: ${err.message}`);
    res.status(500).json({ error: err.message, log: logs });
  } finally {
    if (browser) await browser.close();
  }
});

// -----------------------------
// 🌍 SCRAPE FULL SEASON (API-BASED)
// -----------------------------
app.get("/api/scrape-season", async (req, res) => {
  let browser;
  const logs = [];
  const log = msg => {
    console.log(msg);
    logs.push(`${new Date().toISOString().split("T")[1].split(".")[0]} - ${msg}`);
  };

  try {
    log("🚀 Launching browser...");
    browser = await chromium.launch({ headless: true });
    const page = await browser.newPage();

    let apiResponse = null;

    // Intercept API JSON data when page loads
    page.on("response", async response => {
      const url = response.url();
      if (url.includes("/api/event/list?")) {
        try {
          const json = await response.json();
          apiResponse = json;
        } catch {}
      }
    });

    log("🔍 Navigating to HYROX past events...");
    await page.goto("https://www.hyresult.com/events?tab=past", {
      waitUntil: "domcontentloaded",
      timeout: 0
    });

    // Wait for network API to return data
    let tries = 0;
    while (!apiResponse && tries < 20) {
      await page.waitForTimeout(1000);
      tries++;
    }

    if (!apiResponse) throw new Error("Could not intercept events API.");

    const events = apiResponse?.data?.records || [];
    log(`📅 Found ${events.length} total events in API response`);

    // Take only the 5 most recent completed events
    const selected = events
      .filter(e => e.status === 1) // completed
      .slice(0, 5)
      .map(e => ({
        id: e.id,
        name: e.name,
        city: e.cityName,
        date: e.startDate,
        href: `https://www.hyresult.com/ranking/${e.slug}-men?ag=45-49`
      }));

    log(`✅ Extracted ${selected.length} recent events`);

    const podiums = [];

    for (const ev of selected) {
      try {
        const pageEvent = await browser.newPage();
        log(`🏁 Scraping ${ev.name}`);
        await pageEvent.goto(ev.href, { waitUntil: "domcontentloaded", timeout: 0 });
        await pageEvent.waitForSelector("table tbody tr", { timeout: 20000 });

        const athletes = await pageEvent.evaluate(() => {
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

        podiums.push({ event: ev.name, city: ev.city, date: ev.date, url: ev.href, podium: athletes });
        await pageEvent.close();
      } catch (e) {
        log(`⚠️ Skipped ${ev.name}: ${e.message}`);
      }
    }

    // Save to local file
    const resultData = { date: new Date().toISOString(), events: podiums };
    fs.writeFileSync(dataFile, JSON.stringify(resultData, null, 2));
    log(`💾 Saved ${podiums.length} events to ${dataFile}`);

    res.json({ saved: true, ...resultData, log: logs });
  } catch (err) {
    log(`❌ Fatal: ${err.message}`);
    res.status(500).json({ error: err.message, log: logs });
  } finally {
    if (browser) await browser.close();
  }
});

// -----------------------------
// 📂 VIEW LAST SAVED DATA
// -----------------------------
app.get("/api/last-run", (_, res) => {
  if (!fs.existsSync(dataFile)) return res.status(404).json({ error: "No saved data found" });
  const data = JSON.parse(fs.readFileSync(dataFile, "utf8"));
  res.json(data);
});

app.listen(PORT, () => console.log(`✅ HYROX Season Scraper running on port ${PORT}`));
