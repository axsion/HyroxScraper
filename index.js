import express from "express";
import cors from "cors";
import fetch from "node-fetch";
import * as cheerio from "cheerio";

const app = express();
app.use(cors());

const PORT = process.env.PORT || 3000;
const BROWSERLESS_TOKEN = process.env.BROWSERLESS_TOKEN;
const BROWSERLESS_URL = `https://production-sfo.browserless.io/content?token=${BROWSERLESS_TOKEN}`;

// 1️⃣ Fetch fully rendered HTML from Browserless
async function renderPageHtml(url) {
  const response = await fetch(BROWSERLESS_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ url }),
  });

  if (!response.ok) throw new Error(`Browserless render failed: ${response.status}`);
  return await response.text();
}

// 2️⃣ Parse HTML with Cheerio to extract HYROX results
function extractResults(html) {
  const $ = cheerio.load(html);
  const results = [];

  // Look for rows in the HYROX results table
  $("table tbody tr").each((_, row) => {
    const cols = $(row).find("td");
    const rank = $(cols[0]).text().trim();
    const name = $(cols[2]).text().trim();
    const time = $(cols[7]).text().trim();

    if (rank && name && time) {
      results.push({ rank, name, time });
    }
  });

  // Return top 10 (you can change)
  return results.slice(0, 10);
}

app.get("/api/health", (req, res) => {
  res.json({ status: "ok", message: "HYROX scraper running via Browserless" });
});

app.get("/api/scrape", async (req, res) => {
  try {
    const { eventUrl } = req.query;
    if (!eventUrl) return res.status(400).json({ error: "Missing eventUrl query param" });

    const html = await renderPageHtml(eventUrl);
    const athletes = extractResults(html);

    res.json({
      eventName: "HYROX Event",
      categories: [
        {
          category: "Filtered Page",
          athletes,
        },
      ],
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
});

app.listen(PORT, () => console.log(`✅ Server running on port ${PORT}`));
