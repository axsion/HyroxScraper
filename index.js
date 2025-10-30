import express from "express";
import fs from "fs";
import path from "path";
import { execFile } from "child_process";
import { promisify } from "util";
import playwright from "playwright";

const execFileAsync = promisify(execFile);
const app = express();
const PORT = process.env.PORT || 1000;

const PLAYWRIGHT_DIR = process.env.PLAYWRIGHT_BROWSERS_PATH || "/opt/render/.cache/ms-playwright";

// ---- tiny helper to detect the classic missing-binary error
function isMissingChromiumError(err) {
  const msg = String(err && err.message || err);
  return msg.includes("Executable doesn't exist") || msg.includes("chromium_headless_shell") || msg.includes("chrome-linux");
}

// ---- install Chromium at runtime (idempotent)
async function ensureChromium() {
  // Quick presence check: the Playwright registry knows if chromium is there by returning a path
  try {
    // If chromium is already available, this launch will succeed and immediately be closed
    const tmp = await playwright.chromium.launch({
      headless: true,
      args: ["--no-sandbox", "--disable-dev-shm-usage"]
    });
    await tmp.close();
    console.log("✅ Chromium is already installed and launchable.");
    return;
  } catch (err) {
    if (!isMissingChromiumError(err)) {
      console.log("ℹ️ Chromium launch failed for another reason; still attempting install…", err.message);
    } else {
      console.log("🧩 Chromium missing — installing now…");
    }
  }

  // Attempt install
  console.log("Installing Chromium for Playwright...");
  try {
    await execFileAsync("npx", ["playwright", "install", "chromium"], {
      env: { ...process.env, PLAYWRIGHT_BROWSERS_PATH: PLAYWRIGHT_DIR },
      stdio: "pipe",
      timeout: 10 * 60 * 1000
    });
    console.log("✅ Runtime Chromium install completed.");
  } catch (err) {
    console.error("❌ Runtime install failed:", err.message);
    throw new Error("Chromium install failed at runtime");
  }
}

// ---- unified launcher with auto-retry after install
async function launchChromium() {
  try {
    return await playwright.chromium.launch({
      headless: true,
      args: ["--no-sandbox", "--disable-dev-shm-usage"]
    });
  } catch (err) {
    if (isMissingChromiumError(err)) {
      console.warn("⚠️ Chromium not found at runtime; installing then retrying once…");
      await ensureChromium();
      // retry once
      return await playwright.chromium.launch({
        headless: true,
        args: ["--no-sandbox", "--disable-dev-shm-usage"]
      });
    }
    throw err;
  }
}

/* -----------------------------------------------------------------------------
   your existing cache / scraping code can stay the same
   just make sure that wherever you had:

   const browser = await chromium.launch(...)

   you now use:

   const browser = await launchChromium();

   Below is a minimal scaffold you can adapt around your current handlers.
----------------------------------------------------------------------------- */

const DATA_DIR = path.join(process.cwd(), "data");
const LAST_RUN_FILE = path.join(DATA_DIR, "last-run.json");
if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });

let cache = { events: [] };
try {
  if (fs.existsSync(LAST_RUN_FILE)) {
    cache = JSON.parse(fs.readFileSync(LAST_RUN_FILE, "utf8"));
  }
} catch {}

// Simple example for scraping one URL (replace with your real logic)
async function scrapeOne(url) {
  const browser = await launchChromium();
  const page = await browser.newPage();
  try {
    await page.goto(url, { waitUntil: "networkidle", timeout: 60000 });
    // ... your existing DOM extraction …
    // return extracted data
    return { ok: true, url };
  } finally {
    await browser.close();
  }
}

// --------- DIAGNOSTIC: install browsers on demand
app.get("/api/install-browsers", async (_req, res) => {
  try {
    await ensureChromium();
    res.json({ status: "ok", installed: true, path: PLAYWRIGHT_DIR });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// --------- DIAGNOSTIC: check events list (you already have this)
app.get("/api/check-events", async (_req, res) => {
  try {
    const txt = await fetch("https://raw.githubusercontent.com/axsion/HyroxScraper/main/events.txt").then(r => r.text());
    const urls = txt.split(/\r?\n/).map(s => s.trim()).filter(Boolean);
    const invalid = urls.filter(u => !/^https?:\/\/www\.hyresult\.com\/(ranking|event)\//.test(u));
    const valid = urls.filter(u => !invalid.includes(u));
    res.json({ valid: valid.length, invalid: invalid.length, urls: valid.slice(0, 50) });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// --------- FULL SCRAPE (use your real routine here)
app.get("/api/scrape-all", async (_req, res) => {
  try {
    // 1) make sure chromium exists BEFORE we start
    await ensureChromium();

    // 2) load events.txt
    const txt = await fetch("https://raw.githubusercontent.com/axsion/HyroxScraper/main/events.txt").then(r => r.text());
    const bases = txt.split(/\r?\n/).map(s => s.trim()).filter(Boolean);

    // 3) crawl (replace with your compose+loop logic)
    let added = 0;
    for (const base of bases) {
      // ... expand base → MEN/WOMEN/MIXED & AGs, then:
      const r = await scrapeOne(base);
      if (r) added++;
    }

    // persist cache if you collect events
    fs.writeFileSync(LAST_RUN_FILE, JSON.stringify(cache, null, 2));

    res.json({ added, totalCache: cache.events.length });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get("/api/last-run", (_req, res) => {
  if (!fs.existsSync(LAST_RUN_FILE)) return res.status(404).json({ error: "No cache" });
  res.sendFile(LAST_RUN_FILE);
});

app.get("/", (_req, res) => res.send("✅ HYROX Scraper — Chromium-safe launcher with auto-install & retry"));

app.listen(PORT, () => {
  console.log(`🔥 HYROX Scraper running on port ${PORT}`);
  console.log("✅ Diagnostic route: /api/install-browsers and /api/check-events");
});
