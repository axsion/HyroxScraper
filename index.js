import express from "express";
import { chromium } from "playwright";

const app = express();
const PORT = process.env.PORT || 10000;

// Helper to extract top-3 results from an event page
async function scrapeTop3FromRanking(page, url) {
  console.log("🔍 Opening", url);
  await page.goto(url, { waitUntil: "networkidle" });

  await page.waitForSelector("table tbody tr", { timeout: 15000 });

  const eventName =
    (await page.$eval("h1", el => el.textContent.trim()).catch(() => null)) ||
    "HYROX Event";

  const podium = await page.$$eval("table tbody tr", rows =>
    rows.slice(0, 3).map(row => {
      const cells = row.querySelectorAll("td");
      return {
        rank: cells[1]?.innerText.trim() || "",
        name: cells[3]?.innerText.trim() || "",
        ageGroup: cells[4]?.innerText.trim() || "",
        time: cells[5]?.innerText.trim() || ""
      };
    })
  );

  return { eventName, podium };
}

// Endpoint to scrape a single event
app.get("/api/scrape", async (req, res) => {
  const url = req.query.url;
  if (!url) return res.status(400).json({ error: "Missing ?url=" });

  let browser;
  try {
    browser = await chromium.launch({
      headless: true,
      args: ["--no-sandbox", "--disable-setuid-sandbox"]
    });
    const page = await browser.newPage();
    const data = await scrapeTop3FromRanking(page, url);
    res.json(data);
  } catch (err) {
    console.error("❌ Scrape error:", err);
    res.status(500).json({ error: err.message });
  } finally {
    if (browser) await browser.close();
  }
});

// Health check
app.get("/api/health", (req, res) => {
  res.json({ ok: true });
});

app.listen(PORT, () =>
  console.log(`✅ HYROX Playwright scraper running on port ${PORT}`)
);
