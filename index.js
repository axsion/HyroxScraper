import express from "express";
import { chromium } from "playwright";

const app = express();
const PORT = process.env.PORT || 10000;

process.on("unhandledRejection", err => {
  console.error("🚨 Unhandled Promise Rejection:", err);
});

// --- Health check
app.get("/api/health", (_, res) => res.json({ ok: true }));

// --- Single race scraper (used for one URL)
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

// --- Multi-event (season) scraper with podiums
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
      waitUntil: "domcontentloaded",
      timeout: 0
    });

    // Wait for table container
    await page.waitForSelector(".ant-table-tbody", { timeout: 20000 });
    log("✅ Table container detected");

    // Optional: wait for spinner
    try {
      await page.waitForSelector(".ant-spin", { state: "visible", timeout: 5000 });
      await page.waitForSelector(".ant-spin", { state: "hidden", timeout: 15000 });
      log("✅ Spinner finished loading");
    } catch {
      log("⚠️ No spinner detected or finished instantly");
    }

    // Scroll through page to load all rows (lazy load)
    log("⬇️ Scrolling through page to trigger full load...");
    await page.evaluate(async () => {
      const sleep = ms => new Promise(r => setTimeout(r, ms));
      let lastHeight = 0;
      for (let i = 0; i < 10; i++) {
        window.scrollTo(0, document.body.scrollHeight);
        await sleep(1000);
        const newHeight = document.body.scrollHeight;
        if (newHeight === lastHeight) break;
        lastHeight = newHeight;
      }
    });

    // Wait until links are visible
    await page.waitForFunction(() => {
      return (
        document.querySelectorAll(".ant-table-tbody tr a[href*='/ranking/']").length > 0 ||
        document.querySelectorAll("a[href*='/ranking/']").length > 0
      );
    }, { timeout: 60000 });

    // Extract 5 most recent event links
    const events = await page.evaluate(() => {
      const linkNodes = Array.from(document.querySelectorAll("a[href*='/ranking/']"));
      const seen = new Set();
      const clean = linkNodes
        .map(a => {
          const name = a.innerText.trim();
          const href = a.href;
          if (!name || !href || seen.has(href)) return null;
          seen.add(href);
          return { name, href };
        })
        .filter(Boolean)
        .slice(0, 5);
      return clean;
    });

    log(`📅 Found ${events.length} events, fetching podiums...`);
    if (events.length === 0) throw new Error("No events extracted after scroll");

    const podiums = [];

    // For each event, scrape top 3 athletes
    for (const ev of events) {
      try {
        log(`🏁 Scraping podium for ${ev.name}`);
        const pageEvent = await browser.newPage();
        await pageEvent.goto(ev.href + "-men?ag=45-49", {
          waitUntil: "domcontentloaded",
          timeout: 0
        });
        await pageEvent.waitForSelector("table tbody tr", { timeout: 15000 });

        const eventName = await pageEvent.title();
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

        podiums.push({
          event: ev.name,
          url: ev.href,
          podium: athletes
        });

        await pageEvent.close();
      } catch (e) {
        log(`⚠️ Failed ${ev.name}: ${e.message}`);
      }
    }

    res.json({ season: "HYROX Archive", events: podiums, log: logs });
  } catch (err) {
    log(`❌ Fatal error: ${err.message}`);
    res.status(500).json({ error: err.message, log: logs });
  } finally {
    if (browser) await browser.close();
  }
});

// --- Keep alive
app.listen(PORT, () => console.log(`✅ HYROX Season Scraper running on port ${PORT}`));
