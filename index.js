import express from "express";
import cors from "cors";
import fetch from "node-fetch";

const app = express();
app.use(cors());

const PORT = process.env.PORT || 3000;

async function fetchCategory(event, gender, group) {
  const url = `https://www.hyresult.com/api/rankings/s8-2025-${event}-hyrox-${gender}`;
  const payload = {
    ag: group,
    skip: 0,
    limit: 100,
    sort: [{ field: "time", dir: "asc" }],
  };

  console.log(`🔍 Fetching ${url} with body:`, JSON.stringify(payload));

  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });

  if (!res.ok) {
    console.error(`❌ Failed ${url} (${res.status})`);
    throw new Error(`Failed to fetch ${url}: ${res.status}`);
  }

  const text = await res.text();
  console.log(`📦 Raw response snippet from ${url}: ${text.slice(0, 500)}`);

  let json;
  try {
    json = JSON.parse(text);
  } catch (err) {
    console.error(`⚠️ JSON parse error for ${url}:`, err.message);
    return [];
  }

  const entries = json.data || json.results || json.items || [];
  const top3 = entries.slice(0, 3).map((r, i) => ({
    rank: r.rank || r.position || i + 1,
    name: r.name || r.athlete || r.fullName || "Unknown",
    time: r.time || r.result || r.finishTime || "",
  }));

  console.log(`✅ ${url}?ag=${group} → Found ${entries.length} total, returning top ${top3.length}`);
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
