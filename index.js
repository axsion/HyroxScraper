import express from "express";
import puppeteer from "puppeteer";

const app = express();
const PORT = process.env.PORT || 10000;

// Catégories d'âge et de sexe à suivre
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
  let browser;
  const seasonUrl = "https://www.hyresult.com/season/s8-2025"; // page listant tous les events
  const results = [];

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

    const page = await browser.newPage();
    console.log(`🔍 Fetching season events from ${seasonUrl}`);
    await page.goto(seasonUrl, { waitUntil: "networkidle2", timeout: 0 });

    // 🔹 Récupère tous les liens d’événements HYROX 2025
    const events = await page.evaluate(() => {
      const links = Array.from(document.querySelectorAll("a"))
        .map(a => a.href)
        .filter(href => href.includes("/ranking/") && href.includes("-hyrox-"));
      return Array.from(new Set(links)); // éviter les doublons
    });

    console.log(`📅 Found ${events.length} HYROX events for 2025`);
    await page.close();

    // 🔹 Pour chaque événement, scrape chaque catégorie
    for (const eventUrl of events) {
      const eventResults = { eventName: "", eventUrl, categories: [] };

      for (const cat of categories) {
        const page = await browser.newPage();
        const url = `${eventUrl}-${cat.gender}?ag=${cat.age}`;
        console.log(`🏁 Scraping ${url}`);

        try {
          await page.goto(url, { waitUntil: "networkidle2", timeout: 0 });

          // Vérifie si un tableau est présent
          const tableExists = await page.$("table tbody tr");
          if (!tableExists) {
            console.warn(`⚠️ No results for ${cat.gender} ${cat.age} at ${url}`);
            await page.close();
            continue;
          }

          // Détecte le nom de l’événement une seule fois
          if (!eventResults.eventName) {
            try {
              eventResults.eventName =
                (await page.$eval("h1", el => el.innerText.trim())) ||
                (await page.title()) ||
                "HYROX Event";
              console.log(`📍 Event: ${eventResults.eventName}`);
            } catch {
              eventResults.eventName = "HYROX Event";
            }
          }

          // Extrait les 3 premiers athlètes (podium)
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

          if (athletes.length > 0) {
            eventResults.categories.push({
              category: `${cat.gender.toUpperCase()} ${cat.age}`,
              athletes
            });
          }

          await page.close();
        } catch (err) {
          console.warn(`⚠️ Failed ${cat.gender} ${cat.age}: ${err.message}`);
          await page.close();
        }
      }

      if (eventResults.categories.length > 0) results.push(eventResults);
    }

    console.log(`✅ Completed scraping ${results.length} events`);
    res.json({ season: "2025", events: results });
  } catch (err) {
    console.error("❌ Scrape error:", err);
    res.status(500).json({ error: err.message });
  } finally {
    if (browser) await browser.close();
  }
});

app.listen(PORT, () => {
  console.log(`✅ HYRESULT full season scraper running on port ${PORT}`);
});
