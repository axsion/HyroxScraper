🏋️‍♂️ HYROX Season Scraper

Automated scraper that collects podium results from HYROX events on hyresult.com
, stores them locally, and exposes simple REST endpoints for integration with Google Sheets or automation workflows.

Built with Node.js + Playwright and deployable on Render.

🚀 Features

Scrapes podium results (top 3 athletes) for all HYROX 2024–2025 events.

Supports men and women categories automatically.

Saves results locally in /data/last-run.json (persistent between runs on Render).

Provides REST endpoints for:

Health check

Manual scraping

Automatic refresh (for CRON or Apps Script)

JSON view of stored results

Compact event summaries

Compatible with Google Sheets Apps Script to keep a live “Podium Tracker” sheet updated.

📁 Project Structure
.
├── index.js           # Main Express + Playwright scraper
├── package.json       # Node dependencies and start commands
├── data/
│   └── last-run.json  # Cached results (auto-created)
└── README.md

⚙️ Endpoints
Endpoint	Description	Example
/api/health	Simple check to confirm the app is live.	✅ { "ok": true }
/api/scrape-all?limit=5	Launches a new scrape for up to N events (default: all).	Scrapes last 5
/api/refresh	Safe endpoint to trigger automatic scraping (for cron jobs).	Same as /scrape-all
/api/last-run	Returns the saved JSON file with all podium results.	Data for Google Sheet
/api/events	Returns a compact summary list (event name, gender, best time).	Used for dashboards
🧠 Data Model
{
  "events": [
    {
      "eventName": "Ranking of 2025 Valencia HYROX MEN",
      "gender": "men",
      "url": "https://www.hyresult.com/ranking/s8-2025-valencia-hyrox-men",
      "podium": [
        { "rank": "1", "name": "Cem Ter Burg", "ageGroup": "25-29", "time": "57:59" },
        { "rank": "2", "name": "Lars Rademaker", "ageGroup": "30-34", "time": "58:15" },
        { "rank": "3", "name": "James Ayshford", "ageGroup": "25-29", "time": "58:52" }
      ]
    }
  ]
}

🧩 Environment & Installation
Render deployment

Create a new Web Service on Render.

Connect your GitHub repository.

Use these Build and Start commands:

# Build Command
npm install

# Start Command
PLAYWRIGHT_BROWSERS_PATH=/opt/render/project/.playwright node index.js


Add a build step to install Playwright’s Chromium browser automatically:

npx playwright install --with-deps chromium


Render automatically runs your Express app on the assigned port.

📦 package.json
{
  "name": "hyroxseasonscraper",
  "version": "1.0.0",
  "type": "module",
  "main": "index.js",
  "scripts": {
    "start": "PLAYWRIGHT_BROWSERS_PATH=/opt/render/project/.playwright node index.js",
    "build": "npx playwright install --with-deps chromium"
  },
  "dependencies": {
    "express": "^4.18.2",
    "playwright": "^1.48.0"
  }
}

🧮 Integration with Google Sheets

A Google Apps Script connects directly to the /api/last-run endpoint to append new podium results.

✅ Automatically detects and skips events already present.
✅ Triggers /api/scrape-all if data is missing.
✅ Perfect for daily automation.

Example setup guide:
➡️ Google Sheet integration script
 (the version you already installed)

🔁 Recommended Workflow
Action	Frequency	Trigger
/api/refresh	Daily	Render cron job or Apps Script
/api/last-run	On-demand	Google Sheets fetch
/api/scrape-all?limit=5	Manual	When new events appear
/api/events	Any time	Dashboard summaries
🧰 Local Development
npm install
npx playwright install chromium
node index.js


Then visit:
👉 http://localhost:10000/api/health

🧱 Data Storage

Results saved locally to /data/last-run.json

Updated each time /api/scrape-all or /api/refresh runs.

Example entry:

{
  "date": "2025-10-23T22:00:00Z",
  "events": [ ... ]
}

🧭 Notes

Playwright is more stable than Puppeteer on Render.

The scraper is intentionally rate-limited and sequential to avoid blocking or IP bans.

It’s safe to run frequently (the script deduplicates based on event URL).

Future improvement: CSV export or Google Drive sync endpoint.
