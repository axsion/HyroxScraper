import express from "express";
import puppeteer from "puppeteer";

const app = express();
const PORT = process.env.PORT || 10000;

app.get("/api/scrape", async (req, res) => {
  let browser;
  try {
    // 🔧 Récupère le chemin Chrome depuis le répertoire /tmp
    const browserFetcher = puppeteer.createBrowserFetcher({ path: "/tmp/puppeteer" });
    const revisionInfo = await browserFetcher.download("131.0.6778.204").catch(() => null);
    const executablePath = revisionInfo ? revisionInfo.executablePath : puppeteer.executablePath();

    console.log("✅ Using Chrome from:", executablePath);

    browser = await puppeteer.launch({
      headless: true,
      executablePath,
      args: ["--no-sandbox", "--disable-setuid-sandbox", "--disable-dev-shm-usage"]
    });

    const page = await browser.newPage();
    await page.goto("https://www.hyresult.com/ranking/s8-2025-toronto-hyrox-men?ag=45-49", {
      waitUntil: "networkidle2",
      timeout: 0
    });

    const data = await page.evaluate(() => {
      const rows = Array.from(document.querySelectorAll("table tbody tr"));
      return rows.slice(0, 3).map(row => {
        const cells = row.querySelectorAll("td");
        return {
          rank: cells[1]?.innerText.trim(),
          name: cells[3]?.innerText.trim(),
          time: cells[5]?.innerText.trim()
        };
      });
    });

    res.json({ eventName: "HYROX Toronto 2025", category: "MEN 45-49", athletes: data });
  } catch (err) {
    console.error("❌ Scrape error:", err);
    res.status(500).json({ error: err.message });
  } finally {
    if (browser) await browser.close();
  }
});

app.listen(PORT, () => console.log(`✅ HYROX scraper running on port ${PORT}`));
