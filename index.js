import express from "express";
import { chromium } from "playwright";

const app = express();
const PORT = process.env.PORT || 10000;

process.on("unhandledRejection", err => {
  console.error("🚨 Unhandled Promise Rejection:", err);
});

// --- Health check
app.get("/api/health", (_, res) => res.json({ ok: true }));

// --- Categories
const categories = [
  { gender: "men", age: "45-49" },
  { gender: "men", age: "50-54" },
  { gender: "men", age: "55-59" },
  { gender: "men", age: "60-64" },
  { gender: "men", age: "65-69" },
  { gender: "men", age: "70" },
  { gender: "women", age: "45-49" },
  { gender: "women", age: "50-54" },
  { gender: "women", age: "55-59" },
  { gender: "women", age: "60-64" },
  { gender: "women", age: "65-69" },
  { gender: "women", age: "70" }
];

// --- Single race scrape
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
    log("🚀 Launching Playwright...");
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
    log(`❌ Scrape error: ${err.message}`);
    res.status(500).json({ error: err.message, log: logs });
  } finally {
    if (browser) await browser.close();
  }
});

// --- Multi-event (season) scraper
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

    log("🔍 Visiting past events page...");
    await page.goto("https://www.hyresult.com/events?tab=past", {
      waitUntil: "networkidle",
      timeout: 0
    });

    // Wait for the spinner to finish loading
    try {
      await page.waitForSelector(".ant-spin", { state: "visible", timeout: 10000 });
      await page.waitForSelector(".ant-spin", { state: "hidden", timeout: 20000 });
      log("✅ Spinner finished loading");
    } catch {
      log("⚠️ No spinner detected, continuing...");
    }

    // Wait until at least one ranking link is visible
    const found = await page.waitForFunction(() => {
      return document.querySelectorAll(".ant-table-tbody tr a[href*='/ranking/']").length > 0;
    }, { timeout: 30000 });

    if (!found) throw new Error("No event links found after waiting");

    const events = await page.evaluate(() => {
      const rows = Array.from(document.querySelectorAll(".ant-table-tbody tr"));
      return rows.slice(0, 5).map(row => {
        const linkEl = row.querySelector("a[href*='/ranking/']");
        const name = row.querySelector("a")?.innerText.trim();
        const href = linkEl ? linkEl.href : null;
        return href && name ? { name, href } : null;
      }).filter(Boolean);
    });

    log(`📅 Found ${events.length} events`);
    res.json({ season: "HYROX Archive", events, log: logs });
  } catch (err) {
    log(`❌ Fatal error: ${err.message}`);
    res.status(500).json({ error: err.message, log: logs });
  } finally {
    if (browser) await browser.close();
  }
});

// --- Keep alive
app.listen(PORT, () => console.log(`✅ HYROX Season Scraper running on port ${PORT}`));
