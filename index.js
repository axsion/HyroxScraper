import express from "express";
import cors from "cors";
import fetch from "node-fetch";

const app = express();
app.use(cors());

const PORT = process.env.PORT || 3000;

// Helper to fetch from HYRESULT API
async function fetchCategory(event, gender, group) {
  // ✅ Corrected endpoint
  const url = `https://api.hyresult.com/ranking/s8-2025-${event}-hyrox-${gender}?ag=${group}`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Failed to fetch ${url}: ${res.status}`);
  const json = await res.json();

  // Check if the structure contains "data" or "results"
  const entries = json.data || json.results || [];

  const top3 = entries.slice(0, 3).map(r => ({
    rank: r.rank || r.position,
    name: r.name || r.athlete || r.fullName,
    time: r.time || r.result || r.finishTime || "",
  }));

  console.log(`✅ ${url} → ${top3.length} athletes`);
  return top3;
}

app.get("/api/scrape", async (req, res) => {
  try {
    const event = req.query.event || "toronto";
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

    const results = [];

    for (const cat of categories) {
      try {
        const athletes = await fetchCategory(event, cat.gender, cat.group);
        results.push({
          category: `${cat.gender.toUpperCase()} ${cat.group}`,
          athletes,
        });
      } catch (err) {
        console.warn(`⚠️ Failed ${cat.gender} ${cat.group}: ${err.message}`);
      }
    }

    res.json({ eventName: `HYROX ${event}`, categories: results });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
});

app.get("/api/health", (_, res) => {
  res.json({ status: "ok", source: "hyresult.com API", version: "3.0" });
});

app.listen(PORT, () => console.log(`✅ HYRESULT API scraper running on ${PORT}`));
