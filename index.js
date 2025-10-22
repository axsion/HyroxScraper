import express from "express";
import puppeteer from "puppeteer";

const app = express();
const PORT = process.env.PORT || 10000;

// Petite utilité de scrape d'un tableau de classement (top 3)
async function scrapeTop3FromRanking(page, url) {
  await page.goto(url, { waitUntil: "networkidle2", timeout: 0 });

  // Certaines pages mettent 1–2s avant de rendre le tableau
  await page.waitForSelector("table tbody tr", { timeout: 15000 });

  const eventName =
    (await page.$eval("h1", el => el.innerText.trim()).catch(() => null)) ||
    (await page.title().catch(() => "HYROX Event"));

  const podium = await page.evaluate(() => {
    const rows = Array.from(document.querySelectorAll("table tbody tr"));
    return rows.slice(0, 3).map(row => {
      const cells = row.querySelectorAll("td");
      return {
        rank: cells[1]?.innerText.trim() || "",
        name: cells[3]?.innerText.trim() || "",
        ageGroup: cells[4]?.innerText.trim() || "",
        time: cells[5]?.innerText.trim() || ""
      };
    });
  });

  return { eventName, podium };
}

// Récupère la liste des événements (onglet "past"), renvoie les URL de ranking
async function getPastEventRankingLinks(page, limit = 5) {
  await page.goto("https://www.hyresult.com/events?tab=past", {
    waitUntil: "networkidle2",
    timeout: 0
  });

  // Sur la page "past", on récupère des liens vers /ranking/...
  const links = await page.$$eval("a[href*='/ranking/']", els =>
    els
      .map(el => ({
        name: el.innerText.trim(),
        url: el.href
      }))
      // dédoublonnage simple
      .filter((v, i, a) => a.findIndex(t => t.url === v.url) === i)
  );

  return links.slice(0, limit);
}

// Health-check
app.get("/api/health", (req, res) => {
  res.json({ ok: true });
});

// Scrape un seul event (param : ?url=...)
app.get("/api/scrape", async (req, res) => {
  const url = req.query.url;
  if (!url) return res.status(400).json({ error: "Missing ?url=" });

  let browser;
  try {
    browser = await puppeteer.launch({
      headless: "new",
      args: ["--no-sandbox", "--disable-setuid-sandbox", "--disable-dev-shm-usage"]
    });

    const page = await browser.newPage();
    const data = await scrapeTop3FromRanking(page, url);
    await page.close();

    // Log du chemin Chromium utilisé (utile debug)
    const path = browser
      .browserContexts?.()[0]
      ?.browser()
      ?.process()
      ?.spawnfile;
    console.log("Chromium path:", path);

    res.json({ url, ...data });
  } catch (e) {
    console.error("Scrape error:", e);
    res.status(500).json({ error: String(e.message || e) });
  } finally {
    if (browser) await browser.close();
  }
});

// Scrape la "saison" (événements passés) — param ?limit= (par défaut 5)
app.get("/api/scrape-season", async (req, res) => {
  const limit = Math.max(1, Math.min(50, Number(req.query.limit) || 5));

  let browser;
  try {
    browser = await puppeteer.launch({
      headless: "new",
      args: ["--no-sandbox", "--disable-setuid-sandbox", "--disable-dev-shm-usage"]
    });

    const page = await browser.newPage();
    const events = await getPastEventRankingLinks(page, limit);

    const results = [];
    for (const ev of events) {
      const p = await browser.newPage();
      console.log("Scraping:", ev.name, ev.url);
      try {
        const data = await scrapeTop3FromRanking(p, ev.url);
        results.push({ event: ev.name, url: ev.url, podium: data.podium });
      } catch (err) {
        console.warn("Failed:", ev.url, err?.message || err);
        results.push({ event: ev.name, url: ev.url, podium: [] });
      } finally {
        await p.close();
      }
    }

    res.json({ total: results.length, results });
  } catch (e) {
    console.error("Season scrape error:", e);
    res.status(500).json({ error: String(e.message || e) });
  } finally {
    if (browser) await browser.close();
  }
});

app.listen(PORT, () => {
  console.log(`✅ HYROX season scraper running on ${PORT}`);
});
