import express from "express";
import puppeteer from "puppeteer";
import { executablePath } from "puppeteer";

const app = express();
const PORT = process.env.PORT || 10000;

app.get("/api/scrape", async (req, res) => {
  const eventUrl =
    req.query.eventUrl ||
    "https://www.hyresult.com/ranking/s8-2025-toronto-hyrox-men?ag=45-49";
  console.log(`🔍 Opening ${eventUrl}`);

  let browser;
  try {
    // Ensure Puppeteer cache and binary are stored locally (inside project)
    process.env.PUPPETEER_CACHE_DIR = "./.puppeteer-cache";

    const pathToChrome = await executablePath();

    console.log("✅ Using Chrome executable at:", pathToChrome);

    browser = await puppeteer.launch({
      headless: true,
      executablePath: pathToChrome, // 👈 Explicit path fix
      args: [
        "--no-sandbox",
        "--disable-setuid-sandbox",
        "--disable-dev-shm-usage",
        "--disable-gpu",
        "--no-zygote",
      ],
    });

    const page = await browser.newPage();
    await page.goto(eventUrl, { waitUntil: "networkidle2", timeout: 0 });
    await page.waitForSelector("table tbody tr");

    const athletes = await page.evaluate(() => {
      const rows = Array.from(document.querySelectorAll("table tbody tr"));
      return rows.slice(0, 100).map((row) => {
        const cells = row.querySelectorAll("td");
        return {
          rank: cells[1]?.innerText.trim(),
          name: cells[3]?.innerText.trim(),
          ageGroup: cells[4]?.innerText.trim(),
          time: cells[5]?.innerText.trim(),
        };
      });
    });

    const result = {
      eventName: "HYROX Toronto 2025",
      category: "MEN 45-49",
      athletes,
    };

    console.log(`✅ Scraped ${athletes.length} athletes`);
    res.json(result);
  } catch (err) {
    console.error("❌ Scrape error:", err);
    res.status(500).json({ error: err.message });
  } finally {
    if (browser) await browser.close();
  }
});

app.listen(PORT, () => {
  console.log(`✅ HYRESULT Puppeteer scraper running on port ${PORT}`);
});
