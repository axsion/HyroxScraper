import express from "express";
import cors from "cors";
import { chromium } from "playwright"; // dépendance "playwright"

const app = express();
app.use(cors());

const PORT = process.env.PORT || 3000;

// --- util: scrap top3 d'une page de résultats déjà filtrée ---
async function scrapeTop3FromUrl(url) {
  const browser = await chromium.launch({
    args: ["--no-sandbox", "--disable-setuid-sandbox"],
    headless: true,
  });
  const page = await browser.newPage();
  await page.goto(url, { waitUntil: "networkidle" });
  await page.waitForSelector("table tbody tr", { timeout: 25000 });

  const rows = await page.$$eval("table tbody tr", trs => {
    return trs.slice(0, 3).map(tr => {
      const tds = tr.querySelectorAll("td");
      const safe = i => (tds[i] ? tds[i].innerText.trim() : "");
      // Indices courants observés : 0=rank, 2=name, 7=time (adapter si le site change)
      return {
        rank: safe(0),
        name: safe(2),
        time: safe(7),
      };
    });
  });

  await browser.close();
  return rows;
}

// --- routes ---
app.get("/api/health", (req, res) => {
  res.json({ status: "ok", message: "HYROX scraper is running" });
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
      {
        category: "Women 50-54",
        athletes: [
          { rank: 1, name: "Jane Miller", time: "1:12:33" },
          { rank: 2, name: "Amy Taylor", time: "1:14:21" },
          { rank: 3, name: "Kate Brown", time: "1:15:05" },
        ],
      },
    ],
  });
});

// ✅ 1) Scraper une page unique (déjà filtrée) : /api/scrape?eventUrl=...
app.get("/api/scrape", async (req, res) => {
  try {
    const eventUrl = req.query.eventUrl;
    if (!eventUrl) return res.status(400).json({ error: "Missing eventUrl query param" });

    const top3 = await scrapeTop3FromUrl(eventUrl);
    res.json({
      eventName: "HYROX Event",
      categories: [
        {
          category: "Filtered Page",
          athletes: top3.map((a, i) => ({
            rank: Number(a.rank) || i + 1,
            name: a.name,
            time: a.time,
          })),
        },
      ],
    });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: e.message });
  }
});

// ✅ 2) Scraper TOUTES les catégories Masters pour un event : /api/scrapeMasters?event=2025+Toronto
app.get("/api/scrapeMasters", async (req, res) => {
  const event = req.query.event; // ex: "2025+Toronto"
  if (!event) return res.status(400).json({ error: "Missing event query param (e.g. 2025+Toronto)" });

  const genders = [
    { key: "M", label: "Men" },
    { key: "F", label: "Women" },
  ];
  const ages = ["45","50","55","60","65","70"]; // 70+ agrégé côté HYROX
  const base = "https://results.hyrox.com/season-8/index.php?pid=list&pidp=ranking_nav";

  const categories = [];
  try {
    for (const g of genders) {
      for (const age of ages) {
        const url = `${base}&event_main_group=${encodeURIComponent(event)}&search%5Bsex%5D=${g.key}&search%5Bage_class%5D=${age}&search%5Bnation%5D=%25`;
        const top3 = await scrapeTop3FromUrl(url);
        categories.push({
          category: `${g.label} ${age}${age === "70" ? "+" : "-"+(Number(age)+4)}`,
          athletes: top3.map((a, i) => ({
            rank: Number(a.rank) || i + 1,
            name: a.name,
            time: a.time,
          })),
        });
      }
    }
    res.json({
      eventName: `HYROX ${event.replace(/\+/g, " ")}`,
      categories,
    });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: e.message, categories });
  }
});

app.get("/", (_req, res) => res.send("HYROX Scraper API is active 🚀"));

app.listen(PORT, () => console.log(`✅ Server running on port ${PORT}`));
