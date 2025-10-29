🏋️‍♂️ HYROX Scraper System — Render + Google Sheets Integration (v25.1)
📘 Overview

This project automatically scrapes HYROX Solo and Double podiums from hyresult.com
 for all Masters categories (45-79).
It stores results on a Render server, syncs them to Google Sheets, and can restore data if the server resets.

The system is composed of three coordinated parts:

File	Purpose
index.js	Main Node/Express scraper running on Render (scrapes results, stores cache).
package.json	Node dependencies and launch configuration for Render.
Google Apps Script	Connects your Google Sheet to the Render API — imports new results and restores cache automatically.
🧱 1. index.js (Render Server)

Purpose:
Scrapes all HYROX podiums, saves results to /data/last-run.json, and exposes a REST API used by your Google Sheet.

Key features:

Auto-installs Chromium on Render (works even on free tier).

Supports all Masters age groups:

45-49, 50-54, 55-59, 60-64, 65-69, 70-74, 75-79
50-59, 60-69 (legacy s7)


Crawls both Solo and Double events.

Provides multiple endpoints for control and health checking.

🔗 API Endpoints
Endpoint	Description
/api/scrape-all	Full crawl of all known events (2025 + 2026). Saves all Masters categories.
/api/scrape-weekend	Crawls only the latest weekend events (Paris, Birmingham, etc.).
/api/last-run	Returns JSON of all cached events. Used by Google Sheet.
/api/set-initial-cache	Accepts cache upload from Google Sheet (syncExistingEventsToServer()).
/api/clear-cache	Deletes local cache (last-run.json) — use for full re-scan.
/api/health	Simple JSON response to check if the Render server is online.
🚀 Render Configuration

Environment:

{
  "scripts": {
    "start": "PLAYWRIGHT_BROWSERS_PATH=/opt/render/project/.playwright node index.js"
  },
  "dependencies": {
    "express": "^4.19.2",
    "playwright": "^1.47.2"
  }
}


Render automatically installs dependencies and starts the scraper.
If the service idles and restarts, the cache (/data/last-run.json) will be cleared —
so you’ll need to restore it from Google Sheets (see below).

📗 2. Google Apps Script (Sheet Integration)

Purpose:
Bridges your Google Sheet and Render scraper.

Sheets used:

Podiums → all Solo results

Double-2025 → all Doubles results

Main functions:
Function	Description
updateHyroxResults()	Pulls the latest data from /api/last-run and appends only new rows.
syncExistingEventsToServer()	Uploads all podiums from both sheets to Render in safe batches (restores cache).
clearServerCache()	Clears /data/last-run.json remotely.
checkServerHealth()	Verifies that Render is online and responsive.
🧩 How batch upload works

Uploads data in chunks of 150 events each to avoid “Payload Too Large (413)” errors.

Each batch is confirmed via a "✅ Cache restored" response.

Automatically pauses 1.5 s between batches to avoid rate-limits.

🔄 3. Operating Workflow

Follow this order to safely crawl, sync, and maintain your data:

🏁 A. Run a crawl (server-side)

Visit one of these URLs:

Full crawl:

https://hyroxseasonscraper.onrender.com/api/scrape-all


Latest weekend only:

https://hyroxseasonscraper.onrender.com/api/scrape-weekend


Wait for completion — check Render logs for “🎯 Scrape complete”.

📥 B. Import results into Google Sheets

In your Sheet, open Extensions → Apps Script.

Run:

updateHyroxResults();


New podiums (Solo → Podiums, Doubles → Double-2025) are appended.
Existing ones are skipped automatically.

💾 C. Restore cache after Render restart

Whenever Render redeploys or idles out:

In your Sheet, run:

syncExistingEventsToServer();


The function re-uploads all events in batches (~150 each).

You’ll see logs like:

✅ Uploaded batch 1 …
✅ Uploaded batch 2 …
🎯 Sync complete — 595 total events sent.


Your Render cache (/data/last-run.json) is now repopulated.

🧹 D. Optional maintenance tasks
Action	How	When
Clear cache	Run /api/clear-cache or call clearServerCache()	Before a full re-scan
Check server health	Run checkServerHealth()	Anytime before syncing
View raw data	Visit /api/last-run	To inspect cached JSON
🧠 Best Practices

✅ After every crawl — always run updateHyroxResults()
✅ After every Render restart — run syncExistingEventsToServer()
✅ Never edit rows manually unless you understand the structure
✅ Keep “Podiums” and “Double-2025” headers identical (for consistent merging)

🩵 Troubleshooting
Symptom	Likely Cause	Fix
413 Payload Too Large	Batch size too high or server limit too low	Use chunkSize = 150 and ensure express.json({ limit: "20mb" })
Fetch failed (403/404)	Wrong BASE_URL in Apps Script	Update to your live Render URL
No new rows added	All events already cached	Clear cache or wait for new HYROX events
Render logs show “Installing Chromium” repeatedly	Normal on free tier (temporary filesystem)	
🧾 Example Post-Crawl Summary

After your typical weekend workflow:

✅ HYROX Scraper v25.1 running on port 10000
🔎 Scraping https://www.hyresult.com/ranking/s8-2025-paris-hyrox-doubles-men?ag=50-54
✅ Added Ranking of 2025 PARIS HYROX DOUBLE MEN (50-54)
🎯 Scrape complete — 10 new events added.

[Google Sheet logs]
✅ Uploaded batch 1: {"status":"✅ Cache restored","count":250}
✅ Uploaded batch 2: {"status":"✅ Cache restored","count":250}
✅ Uploaded batch 3: {"status":"✅ Cache restored","count":95}
🎯 Sync complete — 595 total events sent.

✅ In Summary
Step	You run	Purpose
1️⃣	/api/scrape-weekend	Crawl new Masters podiums
2️⃣	updateHyroxResults()	Append to Google Sheets
3️⃣	(After restart) syncExistingEventsToServer()	Restore cache
4️⃣	Optional: /api/clear-cache	Force fresh crawl

💡 Result:
You now have a complete, automated, bilingual-ready HYROX data pipeline —
from official results to your Google Sheets dashboard — fully restart-safe and expandable for 2025 + 2026 seasons.
