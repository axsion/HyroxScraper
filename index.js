/**
 * HYROX Debug Scraper – single URL test
 * Purpose: verify that Playwright can load hyresult.com and read the table
 */

import express from "express";
import { chromium } from "playwright";

const app = express();
const PORT = process.env.PORT || 10000;

// Test URL
const TEST_URL = "https://www.hyresult.com/ranking/s8-2025-toronto-hyrox-men";

app.get("/api/health", (_, res) => res.json({ ok: true }));

app.get("/api/test", async (_, res) => {
  const browser = await chromium.launch({
    headless: true,
    args: [
      "--no-sandbox",
      "--disable-gpu",
      "--disable-dev-shm-usage",
      "--disable-blink-features=AutomationControlled"
    ]
  });
  const page = await browser.newPage();

  // Pretend to be a normal Chrome browser
  await page.setExtraHTTPHeaders({
    "User-Agent":
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0 Safari/537.36"
  });

  console.log(`🔎 Loading ${TEST_URL}`);
  await page.goto(TEST_URL, { waitUntil: "networkidle", timeout: 90000 });

  // Log what we actually see
  const html = await page.content();
  console.log("=== HTML preview (first 2000 chars) ===");
  console.log(html.substring(0, 2000));

  // Try to read table rows
  const rows = await page.$$eval("table tr", trs =>
    Array.from(trs).map(tr =>
      Array.from(tr.querySelectorAll("td")).map(td => td.innerText.trim())
    )
  );

  await browser.close();

  res.json({
    scrapedAt: new Date().toISOString(),
    rowCount: rows.length,
    sampleRows: rows.slice(0, 3)
  });
});

app.listen(PORT, () =>
  console.log(`✅ HYROX Debug server running on port ${PORT}`)
);
