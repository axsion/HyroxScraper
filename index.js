import express from "express";
import puppeteer from "puppeteer";

const app = express();
const PORT = process.env.PORT || 10000;

app.get("/api/scrape", async (req, res) => {
  try {
    const eventUrl = req.query.eventUrl || "https://www.hyresult.com/ranking/s8-2025-toronto-hyrox-men?ag=45-49";
    console.log(`🔍 Opening ${eventUrl}`);

    // Launch Puppeteer in headless mode (Render-friendly)
    const browser = await puppeteer.launch({
      headless: true,
      args: ["--no-sandbox", "--disable-setuid-sandbox"],
    });

    const page = await browser.newPage();
    await page.goto(eventUrl, { waitUntil: "networkidle2", timeout: 0 });

    // Wait until the first row of the table appears
    await page.waitForSelector("table tbody tr");

    // Extract data from table rows
    const athletes = await page.evaluate(() => {
      const rows = Array.from(document.querySelectorAll("table tbody tr"));
      return rows.slice(0, 100).map(row => {
        const cells = row.querySelectorAll("td");
        return {
          rank: cells[1]?.innerText.trim(),
          name: cells[3]?.innerText.trim(),
          ageGroup: cells[4]?.innerText.trim(),
          time: cells[5]?.innerText.trim(),
        };
      });
    });

    await browser.close();

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
  }
});

app.listen(PORT, () => {
  console.log(`✅ HYRESULT Puppeteer scraper running on ${PORT}`);
});
