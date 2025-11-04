/**
 * HYROX Scraper v4.4 — Fly.io Stable
 * -----------------------------------
 * ✅ Express server with /api/test-one (single event tester)
 * ✅ Playwright (Chromium) dynamic rendering support
 * ✅ Waits for DOM-rendered tables (not static HTML)
 * ✅ Compatible with Render/Fly.io ephemeral environments
 */

import express from "express";
import fetch from "node-fetch";
import { chromium } from "playwright-core";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PORT = process.env.PORT || 10000;
const app = express();

// Optional: persistent cache (if /data exists)
const DATA_DIR = fs.existsSync("/data") ? "/data" : path.join(__dirname, "data");
if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });

// Canonical HYROX events list
const EVENTS_URL =
  "https://raw.githubusercontent.com/axsion/HyroxScraper/main/events.txt";
const EVENTS_CACHE_FILE = path.join(DATA_DIR, "events-cache.txt");

// -------------------------
// 🩺 Health check
// -------------------------
app.get("/api/health", (req, res) =>
  res.json({ ok: true, app: "HYROX Scraper v4.4", now: new Date().toISOString() })
);

// -------------------------
// 📋 Check events list
// -------------------------
app.get("/api/check-events", async (req, res) => {
  try {
    let urls = [];

    if (req.query.refresh === "true" || !fs.existsSync(EVENTS_CACHE_FILE)) {
      console.log("🔁 Refreshing events from GitHub...");
      const resp = await fetch(EVENTS_URL);
      if (!resp.ok) throw new Error(`Failed to fetch events list: ${resp.status}`);
      const text = await resp.text();
      fs.writeFileSync(EVENTS_CACHE_FILE, text);
      urls = text.split("\n").filter(Boolean);
    } else {
      const cached = fs.readFileSync(EVENTS_CACHE_FILE, "utf-8");
      urls = cached.split("\n").filter(Boolean);
    }

    res.json({ baseCount: urls.length, sample: urls.slice(0, 10) });
  } catch (err) {
    console.error("❌ Error loading events:", err);
    res.status(500).json({ error: err.message });
  }
});

// -------------------------
// 🧪 TEST ONE URL (single event podium extractor)
// -------------------------
app.get("/api/test-one", async (req, res) => {
  const url =
    req.query.url ||
    "https://www.hyresult.com/ranking/s8-2025-birmingham-hyrox-doubles-mixed?ag=45-49";

  console.log(`🎯 Testing single HYROX event:\n${url}`);

  let browser;
  try {
    browser = await chromium.launch({
      headless: true,
      args: [
        "--no-sandbox",
        "--disable-setuid-sandbox",
        "--disable-dev-shm-usage",
        "--disable-gpu",
        "--single-process"
      ],
      // Adjust path as needed if you ship Chromium in Docker
      executablePath:
        process.env.CHROMIUM_PATH ||
        "/usr/bin/chromium" ||
        "/usr/bin/chromium-browser" ||
        "/usr/bin/google-chrome"
    });

    const page = await browser.newPage();
    await page.goto(url, { waitUntil: "networkidle" });

    // Wait until the podium rows are injected
    await page.waitForSelector("table tbody tr", { timeout: 20000 });

    // Evaluate inside the rendered DOM
    const podium = await page.evaluate(() => {
      const rows = Array.from(document.querySelectorAll("table tbody tr")).slice(0, 3);
      return rows.map((r) => {
        const cells = r.querySelectorAll("td");
        return {
          rank: cells[0]?.innerText?.trim() || "",
          name: cells[1]?.innerText?.trim() || "",
          team: cells[2]?.innerText?.trim() || "",
          time: cells[cells.length - 1]?.innerText?.trim() || ""
        };
      });
    });

    if (!podium.length) {
      // Save debug screenshot for inspection
      const debugPath = path.join(DATA_DIR, "debug.png");
      await page.screenshot({ path: debugPath });
      console.warn(`⚠️ No podium rows found. Screenshot saved to ${debugPath}`);
      return res.json({ ok: false, message: "No podium rows found", url });
    }

    console.log("✅ Extracted podium:", podium);
    res.json({ ok: true, url, podium });
  } catch (err) {
    console.error("❌ Error testing single event:", err);
    res.status(500).json({ ok: false, error: err.message });
  } finally {
    if (browser) await browser.close();
  }
});

// -------------------------
// 🚀 (Optional placeholder) scrape-all
// -------------------------
app.post("/api/scrape-all", async (req, res) => {
  // Placeholder while testing /api/test-one
  res.json({
    accepted: true,
    planned: 0,
    note: "Use /api/test-one first to validate DOM extraction before scaling up."
  });
});

// -------------------------
// 🧩 Start Express
// -------------------------
app.listen(PORT, "0.0.0.0", () => {
  console.log(`✅ HYROX Scraper v4.4 listening on 0.0.0.0:${PORT}`);
});
