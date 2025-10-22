import express from "express";
import puppeteer from "puppeteer";

const app = express();
const PORT = process.env.PORT || 10000;

const categories = [
  { gender: "men", age: "45-49" },
  { gender: "men", age: "50-54" },
  { gender: "men", age: "55-59" },
  { gender: "men", age: "60-64" },
  { gender: "men", age: "65-69" },
  { gender: "men", age: "70" },
  { gender: "women", age: "45-49" },
  { gender: "women", age: "50-54" },
  { gender: "women", age: "55-59" },
  { gender: "women", age: "60-64" },
  { gender: "women", age: "65-69" },
  { gender: "women", age: "70" }
];

app.get("/api/scrape", async (req, res) => {
  const baseEvent = "https://www.hyresult.com/ranking/s8-2025-toronto-hyrox-";
  let browser;
  let eventName = "HYROX Event";

  try {
    browser = await puppeteer.launch({
      headless: true,
      args: [
        "--no-sandbox",
        "--disable-setuid-sandbox",
        "--disable-dev-shm-usage",
        "--disable-gpu"
      ]
    });

    const results = [];

    for (const cat of categories) {
      const page = await browser.newPage();
      const url = `${baseEvent}${cat.gender}?ag=${cat.age}`;
      console.log(`🔍 Scraping ${url}`);

      try {
        await page.goto(url, { waitUntil: "networkidle2", timeout: 0 });

        // Vérifie si le tableau existe avant d’attendre
        const tableExists = await page.$("table tbody tr");
        if (!tableExists) {
          console.warn(`⚠️ No results table found for ${cat.gender} ${cat.age}`);
          results.push({ category: `${cat.gender.toUpperCase()} ${cat.age}`, athletes: [] });
          await page.close();
          continue;
        }

        // Attend le tableau si présent
        await page.waitForSelector("table tbody tr", { timeout: 20000 });

        // Récupère le nom de l’événement une seule fois
        if (eventName === "HYROX Event") {
          eventName =
            (await page.$eval("h1", el => el.innerText.trim())) ||
            (await page.title()) ||
            "HYROX Event";
          console.log(`📍 Event detected: ${eventName}`);
        }

        // Extrait les données
        const athletes = await page.evaluate(() => {
          const rows = Array.from(document.querySelectorAll("table tbody tr"));
          return rows.slice(0, 3).map(row => {
            const cells = row.querySelectorAll("td");
            return {
              rank: cells[1]?.innerText.trim(),
              name: cells[3]?.innerText.trim(),
              ageGroup: cells[4]?.innerText.trim(),
              time: cells[5]?.innerText.trim()
            };
          });
        });

        results.push({
          category: `${cat.gender.toUpperCase()} ${cat.age}`,
          athletes
        });
        await page.close();
      } catch (err) {
        console.warn(`⚠️ Failed ${cat.gender} ${cat.age}: ${err.message}`);
        results.push({
          category: `${cat.gender.toUpperCase()} ${cat.age}`,
          athletes: []
        });
      }
    }

    res.json({ eventName, categories: results });
  } catch (err) {
    console.error("❌ Scrape error:", err);
    res.status(500).json({ error: err.message });
  } finally {
    if (browser) await browser.close();
  }
});

app.listen(PORT, () => {
  console.log(`✅ HYRESULT multi-category scraper running on port ${PORT}`);
});
