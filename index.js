import express from "express";
import { chromium } from "playwright";

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
  { gender: "women", age: "70" },
];

// Health check route
app.get("/api/health", (req, res) => {
  res.json({ ok: true });
});

app.get("/api/scrape-season", async (req, res) => {
  let browser;
  try {
    console.log("🚀 Launching browser...");
    browser = await chromium.launch({ headless: true });
    const page = await browser.newPage();

    console.log("🔍 Visiting events page...");
    await page.goto("https://www.hyresult.com/events?tab=past", {
      waitUntil: "networkidle",
      timeout: 0,
    });

    // ✅ Wait for the React table to render (HYRESULT uses Ant Design tables)
    await page.waitForSelector(".ant-table-tbody tr", { timeout: 20000 });

    // ✅ Extract event names + links from the table
    const events = await page.evaluate(() => {
      const rows = Array.from(document.querySelectorAll(".ant-table-tbody tr"));
      return rows.slice(0, 5).map(row => {
        const linkEl = row.querySelector("a[href*='/ranking/']");
        const name = row.querySelector("a")?.innerText.trim();
        const href = linkEl ? linkEl.href : null;
        return href && name ? { name, href } : null;
      }).filter(Boolean);
    });

    console.log(`📅 Found ${events.length} recent events`);

    const allResults = [];

    for (const event of events) {
      console.log(`🏁 Scraping ${event.name}`);
      const eventData = {
        eventName: event.name,
        url: event.href,
        categories: [],
      };

      for (const cat of categories) {
        const catUrl = `${event.href}-${cat.gender}?ag=${cat.age}`;
        console.log(`   🔸 ${catUrl}`);
        const catPage = await browser.newPage();
        try {
          await catPage.goto(catUrl, { waitUntil: "domcontentloaded", timeout: 15000 });
          await catPage.waitForSelector("table tbody tr", { timeout: 8000 });

          const athletes = await catPage.evaluate(() => {
            const rows = Array.from(document.querySelectorAll("table tbody tr"));
            return rows.slice(0, 3).map(row => {
              const cells = row.querySelectorAll("td");
              return {
                rank: cells[1]?.innerText.trim(),
                name: cells[3]?.innerText.trim(),
                ageGroup: cells[4]?.innerText.trim(),
                time: cells[5]?.innerText.trim(),
              };
            });
          });

          eventData.categories.push({
            category: `${cat.gender.toUpperCase()} ${cat.age}`,
            athletes,
          });
        } catch (err) {
          console.warn(`⚠️ Failed ${cat.gender} ${cat.age}: ${err.message}`);
          eventData.categories.push({
            category: `${cat.gender.toUpperCase()} ${cat.age}`,
            athletes: [],
          });
        } finally {
          await catPage.close();
        }
      }

      allResults.push(eventData);
    }

    res.json({ season: "HYROX Archive", events: allResults });
  } catch (err) {
    console.error("❌ Scrape error:", err);
    res.status(500).json({ error: err.message });
  } finally {
    if (browser) await browser.close();
  }
});
app.listen(PORT, () => {
  console.log(`✅ HYROX Season scraper running on port ${PORT}`);
});
