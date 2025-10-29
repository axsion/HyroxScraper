🏋️ HYROX Scraper Ecosystem — 2025-2026 Edition

This project automatically crawls HYROX race results (Solo + Doubles) from hyresult.com, stores them on a Render server, and syncs them with a Google Sheet.
It is designed to run forever without modification as new events or seasons are released.

📁 Project Overview
Component	Location	Purpose
index.js	Render (Node.js server)	Crawls HYROX results using Playwright; saves all events to data/last-run.json; exposes REST API endpoints.
package.json	Render	Declares Node dependencies and ensures Playwright auto-installs Chromium on Render free tier.
Code.gs (Google Sheets App Script)	Your Google Sheet → Extensions → Apps Script	Connects the sheet to Render. Fetches new events, appends them to the correct sheet tabs, and restores cache after Render restarts.
⚙️ 1. Deploying the Server on Render

Go to Render.com
 → New Web Service

Connect your GitHub repo or manually upload index.js and package.json

Runtime: Node 22 + Playwright

Build Command:

npx playwright install chromium


Start Command:

PLAYWRIGHT_BROWSERS_PATH=/opt/render/project/.playwright node index.js


Deploy → you should see in logs:

✅ Chromium already installed.
🔥 HYROX Scraper v22 running on port 10000


✅ Once live, your base URL will look like:

https://hyroxseasonscraper.onrender.com

🌐 2. Server Endpoints
Endpoint	Description	When to use
/	Health landing page	Quick “is server alive?” check
/api/health	Returns { ok: true }	For monitoring
/api/last-run	Returns all cached events in JSON	Used by Google Sheet
/api/scrape-all	Launches a full crawl (Solo + Double + all cities + seasons S7–S9)	Run manually when new events are added
/api/set-initial-cache	Accepts POST payload { events:[…] } to restore cache	Used by syncExistingEventsToServer() if Render restarts
/api/clear-cache	Clears all stored events	Maintenance only

🟡 (Optional)
You can later add /api/scrape-weekend if you want to crawl only the most recent competitions (e.g. Paris + Birmingham).

📄 3. Google Sheet Integration
Step 1 — Prepare your sheet

Create or open a Google Sheet with these exact headers in row 1:

Event plus Cat | Event | City | Date | Category | Gender | Gold | Time1 | Silver | Time2 | Bronze | Time3


Create 3 tabs:

Podiums → for Solo 2025

Double-2025 → for Doubles 2025

Solo-2026 / Double-2026 → for next season (optional)

Step 2 — Install the Apps Script

In the Sheet → Extensions → Apps Script

Replace all code with the contents of your Code.gs (header-aligned version)

Save → click Run → updateHyroxResults()
Grant permissions if prompted.

Step 3 — Link to Render

Make sure BASE_URL at the top of the script matches your deployed endpoint:

const BASE_URL = "https://hyroxseasonscraper.onrender.com";

Step 4 — Available functions
Function	What it does	When to run
updateHyroxResults()	Fetches /api/last-run from Render and appends new rows only	Daily or weekly (can schedule trigger)
syncExistingEventsToServer()	Sends all existing Sheet data back to Render to rebuild its cache	Run once after a Render restart or fresh deployment
🚀 Typical Workflow
Step	Action	Result
1	Deploy index.js + package.json on Render	Server live, ready to scrape
2	Visit /api/scrape-all once	Crawls every HYROX 2025–2026 event
3	Open your Google Sheet → Run updateHyroxResults()	Adds podium data to correct tabs
4	(If Render restarts) Run syncExistingEventsToServer()	Repopulates server cache from Sheet
5	Optionally schedule updateHyroxResults() trigger (e.g. daily @ 6 AM)	Keeps Sheet up to date automatically
🧠 How the pieces talk
[HYROX Website] ─▶ (Playwright crawler in index.js)
       │
       ▼
[data/last-run.json]  ← cache of all podiums
       │
   (served by Render API)
       │
       ▼
[Google Sheets Apps Script]
       │
       ▼
[Sheets tabs: Podiums / Double-2025 / Solo-2026]

🧩 Error handling tips
Symptom	Likely cause	Fix
Google Sheet shows “Internal Server Error 500”	Server rejected malformed event data	Replace syncExistingEventsToServer() with sanitized version (already in v21 script)
Rows appear but names missing	HYROX page structure changed	Update scrapeSingle() in index.js (header-aware version provided)
Render log shows “Executable doesn’t exist … headless_shell”	Browser missing	Re-deploy with npx playwright install chromium in build step
Duplicate rows	Cache cleared or sheet header mismatch	Confirm headers & rerun syncExistingEventsToServer()
🔄 Automation suggestion

Set up a time-based trigger in Apps Script:

Function: updateHyroxResults

Frequency: Every 6 hours
✅ Your sheet will always reflect the latest podiums automatically.

🧩 File summary
File	Role	Key Dependencies
index.js	Node.js Express + Playwright crawler + API	express, playwright, fs, path
package.json	Declares dependencies, ensures browser auto-install	"type": "module", Playwright pinned
Code.gs	Connects Google Sheet to Render API	UrlFetchApp (Google Apps Script built-in)
✅ Quick verification checklist

https://hyroxseasonscraper.onrender.com/api/health → { ok: true }

https://hyroxseasonscraper.onrender.com/api/last-run → shows cached JSON

Run updateHyroxResults() → rows added correctly

syncExistingEventsToServer() → returns ✅ Cache restored
