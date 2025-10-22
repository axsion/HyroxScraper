import express from "express";
import puppeteer from "puppeteer-core";
import { computeExecutablePath } from "@puppeteer/browsers";

const app = express();
const PORT = process.env.PORT || 10000;

// Get Chrome path dynamically
async function getChromePath() {
  return computeExecutablePath({
    browser: "chrome",
    buildId: "stable",
    cacheDir: "/opt/render/.cache/puppeteer"
  });
}

// Scrape a single event page
async function scrapeEvent(page, url) {
  try {
    await page.goto(url, { waitUntil: "networkidle2", timeout: 0 });
    await page.waitForSelector("table tbody tr", { timeout: 10000 });

    const eventName = await page.$eval("h1", el => el.innerText.trim());
    const top3 = await page.evaluate(() => {
      const rows = Array.from(document.querySelectorAll("table tbody tr"));
      return rows.slice(0, 3).map(row => {
        const cells = row.querySelectorAll("td");
        return {
          rank: cells[1]?.innerText.trim(),
          name: cells[3]?.innerText.trim(),
          time: cells[5]?.innerText.trim()
        };
      });
    });

    return { event: eventName, url, podium: top3 };
  } catch (err) {
    console.warn(`⚠️ Failed to scrape ${url}: ${err.message}`);
    return { event: url, podium: [] };
  }
}

// Main endpoint for the full season
app.get("/api/scrape-season", async (req, res) => {
  let browser;
  const baseUrl = "https://www.hyresult.com/events?tab=past";
  const results = [];

  try {
    const chromePath = await getChromePath();
    browser = await puppeteer.launch({
      headless: true,
      executablePath: chromePath,
      args: ["--no-sandbox", "--disable-setuid-sandbox"]
    });

    const page = await browser.newPage();
    await page.goto(baseUrl, { waitUntil: "networkidle2", timeout: 0 });

    const eventLinks = await page.$$eval("a[href*='/ranking/']", els =>
      els.map(el => ({
        name: el.innerText.trim(),
        url: el.href
      }))
    );

    console.log(`🧭 Found ${eventLinks.length} past events`);

    for (const event of eventLinks.slice(0, 5)) {
      console.log(`🏁 Scraping ${event.name}`);
      const newPage = await browser.newPage();
      const data = await scrapeEvent(newPage, event.url);
      results.push(data);
      await newPage.close();
    }

    res.json({ totalEvents: results.length, results });
  } catch (err) {
    console.error("❌ Global error:", err);
    res.status(500).json({ error: err.message });
  } finally {
    if (browser) await browser.close();
  }
});

app.listen(PORT, () =>
  console.log(`✅ HYROX season scraper running on ${PORT}`)
);
