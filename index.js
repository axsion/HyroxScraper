import express from "express";
import cors from "cors";
import fetch from "node-fetch";

const app = express();
app.use(cors());

const PORT = process.env.PORT || 3000;

// 🧠 Put your Browserless token in Render environment variables
//   Key: BROWSERLESS_TOKEN
//   Value: <your-browserless-token>

const BROWSERLESS_TOKEN = process.env.BROWSERLESS_TOKEN;
const BROWSERLESS_URL = `https://production-sfo.browserless.io/content?token=${BROWSERLESS_TOKEN}`;

// Helper: render page HTML via Browserless cloud
async function renderPageHtml(url) {
  const response = await fetch(BROWSERLESS_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ url }),
  });
  if (!response.ok) throw new Error(`Browserless render failed: ${response.status}`);
  return await response.text();
}

// Simplified parser (placeholder)
function extractTop3FromHtml(html) {
  const rows = [];
  const regex = /<td[^>]*>(\d+)<\/td>\s*<td[^>]*>(.*?)<\/td>\s*<td[^>]*>(.*?)<\/td>/gi;
  let m;
  while ((m = regex.exec(html)) !== null && rows.length < 3) {
    rows.push({ rank: m[1], name: m[2].replace(/<[^>]+>/g, ""), time: m[3] });
  }
  return rows;
}

app.get("/api/health", (req, res) => {
  res.json({ status: "ok", message: "HYROX scraper running via Browserless" });
});

app.get("/api/sample", (req, res) => {
  res.json({
    eventName: "2025 HYROX Sample Event",
    categories: [
      {
        category: "Men 45-49",
        athletes: [
          { rank: 1, name: "John Doe", time: "1:05:23" },
          { rank: 2, name: "Mark Smith", time: "1:06:45" },
          { rank: 3, name: "David Wilson", time: "1:08:12" },
        ],
      },
    ],
  });
});

// ✅ Main endpoint
app.get("/api/scrape", async (req, res) => {
  try {
    const { eventUrl } = req.query;
    if (!eventUrl) return res.status(400).json({ error: "Missing eventUrl query param" });

    const html = await renderPageHtml(eventUrl);
    const top3 = extractTop3FromHtml(html);

    res.json({
      eventName: "HYROX Event",
      categories: [{ category: "Filtered Page", athletes: top3 }],
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
});

app.listen(PORT, () => console.log(`✅ Server running on port ${PORT}`));
