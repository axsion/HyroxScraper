/**
 * HYROX Scraper v4.5 - Fly.io Stable Release
 * ------------------------------------------
 * ✅ Fully compatible with Playwright 1.56.1
 * ✅ Uses dynamic Chromium path (works on Fly.io or local)
 * ✅ Correctly extracts podiums using page.evaluate after full load
 * ✅ Includes /api/test-one, /api/health, /api/scrape-all endpoints
 */

import express from "express";
import * as cheerio from "cheerio";
import { chromium } from "playwright-core";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

// ------------------ Basic Setup ------------------
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PORT = process.env.PORT || 10000;
const app = express();

app.use(express.json());

// Dynamic Chromium binary detection
const CHROMIUM_PATH =
  process.env.CHROMIUM_PATH ||
  "/ms-playwright/chromium-1194/chrome-linux/chrome";

// ------------------ Logger Helper ------------------
const logFile = path.join("/data", `scraper-${new Date().toISOString().slice(0, 10)}.txt`);
function log(msg) {
  const line = `[${new Date().toISOString()}] ${msg}`;
  console.log(line);
  try {
    fs.appendFileSync(logFile, line + "\n");
  } catch {}
}

// ------------------ Utils ------------------
async function delay(ms) {
  return new Promise((res) => setTimeout(res, ms));
}

async function launchBrowser() {
  log(`🚀 Launching Chromium at ${CHROMIUM_PATH}`);
  return await chromium.launch({
    args: ["--no-sandbox", "--disable-setuid-sandbox"],
    headless: true,
    executablePath: CHROMIUM_PATH,
  });
}

// ------------------ Podium Extraction ------------------
async function extractPodium(url) {
  const browser = await launchBrowser();
  const page = await browser.newPage();

  log(`🔎 Opening ${url}`);
  await page.goto(url, { waitUntil: "domcontentloaded", timeout: 60000 });

  // Wait for the results table to render
  await page.waitForSelector("table tbody tr", { timeout: 60000 });

  // Evaluate DOM after Vue/React render
  const podium = await page.evaluate(() => {
    const rows = Array.from(document.querySelectorAll("table tbody tr")).slice(0, 3);
    return rows.map((r) => {
      const cells = Array.from(r.querySelectorAll("td"))
        .map((td) => td.innerText.trim())
        .filter((txt) => txt && txt.toLowerCase() !== "analyze"); // remove junk buttons

      // Most result tables are like [rank, name/team, time]
      return {
        rank: cells[0] || "",
        team: cells[1] || "",
        members: cells[2] || "",
        time: cells[cells.length - 1] || "",
      };
    });
  });

  await browser.close();
  log(`✅ Extracted ${podium.length} podium entries from ${url}`);
  return podium;
}

// ------------------ API Routes ------------------

// Health check
app.get("/api/health", (req, res) => {
  res.json({ ok: true, app: "HYROX Scraper v4.5", now: new Date().toISOString() });
});

// Test one URL
app.get("/api/test-one", async (req, res) => {
  const testUrl =
    "https://www.hyresult.com/ranking/s8-2025-birmingham-hyrox-doubles-mixed?ag=45-49";
  try {
    const podium = await extractPodium(testUrl);
    res.json({ ok: true, url: testUrl, podium });
  } catch (err) {
    log(`❌ Error testing one: ${err.message}`);
    res.json({ ok: false, error: err.message });
  }
});

// Full scrape-all (dummy mode for now)
app.post("/api/scrape-all", async (req, res) => {
  log("🧠 scrape-all called (dummy mode for Fly.io single-test stage)");
  res.json({
    accepted: true,
    planned: 0,
    force: !!req.query.force,
    note: "Background crawl disabled in test mode",
  });
});

// Logs
app.get("/api/logs", async (req, res) => {
  if (!fs.existsSync(logFile)) {
    return res.json({ file: path.basename(logFile), lines: [] });
  }
  const lines = fs.readFileSync(logFile, "utf-8").split("\n").slice(-100);
  res.json({ file: path.basename(logFile), lines });
});

// ------------------ Start Server ------------------
app.listen(PORT, "0.0.0.0", () => {
  log(`✅ HYROX Scraper v4.5 listening on 0.0.0.0:${PORT}`);
});
