import express from "express";
import cors from "cors";
import fetch from "node-fetch";
import * as cheerio from "cheerio";

const app = express();
app.use(cors());

const PORT = process.env.PORT || 3000;

// Helper function to scrape HYRESULT
async function scrapeHyResult(url) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Failed to fetch: ${res.statusText}`);
  const html = await res.text();
  const $ = cheerio.load(html);

  const results = [];
  $("table tbody tr").each((i, row) => {
    const cols = $(row).find("td");
    const rank = $(cols[0]).text().trim();
    const name = $(cols[2]).text().trim();
    const time = $(cols[6]).text().trim();

    if (rank && name && time) {
      results.push({ rank, name, time });
    }
  });

  return results.slice(0, 3);
}

app.get("/api/health", (_, res) => {
  res.json({ status: "ok", source: "HYRESULT.com", version: "1.0" });
});

// ✅ Example: /api/scrape?event=toronto-2025
app.get("/api/scrape", async (req, res) => {
  try {
    const event = req.query.event;
    if (!event) return res.status(400).json({ error: "Missing ?event parameter" });

    const categories = [
      { gender: "men", group: "45-49" },
      { gender: "men", group: "50-54" },
      { gender: "men", group: "55-59" },
      { gender: "men", group: "60-64" },
      { gender: "men", group: "65-69" },
      { gender: "men", group: "70" },
      { gender: "women", group: "45-49" },
      { gender: "women", group: "50-54" },
      { gender: "women", group: "55-59" },
      { gender: "women", group: "60-64" },
      { gender: "women", group: "65-69" },
      { gender: "women", group: "70" },
    ];

    const allData = [];

    for (const cat of categories) {
      const url = `https://www.hyresult.com/ranking/s8-2025-${event}-hyrox-${cat.gender}?ag=${cat.group}`;
      console.log(`🔍 Scraping ${url}`);
      try {
        const athletes = await scrapeHyResult(url);
        allData.push({
          category: `${cat.gender.toUpperCase()} ${cat.group}`,
          athletes,
        });
      } catch (err) {
        console.warn(`⚠️ Failed for ${cat.gender} ${cat.group}: ${err.message}`);
      }
    }

    res.json({
      eventName: `HYROX ${event}`,
      categories: allData,
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.listen(PORT, () => console.log(`✅ HYRESULT scraper running on port ${PORT}`));
