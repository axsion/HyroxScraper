HYROX Masters Podium Scraper

Automatically collects HYROX Masters age-group podium results (SOLO + DOUBLES) for S7 and S8 seasons, stores them, and syncs them to Google Sheets for clean reporting and media production.

Supports:

SOLO MEN / WOMEN

DOUBLES MEN / WOMEN / MIXED

S8 full Masters brackets (45–49 … 75–79)

S7 dual bracket support (45–79 and/or 40–49 / 50–59 / 60–69, depending on event)

All events listed in events.txt

Runs on:

Node.js

Fly.io (serverless deployment)

Google Sheets for output

Project Structure
HyroxScraper/
│
├── index.js          # Main scraper + API server
├── package.json      # Dependencies
├── fly.toml          # Deployment config (Fly.io)
└── events.txt        # List of HYROX event slugs to scrape

How It Works

The scraper loads event slugs from:

https://raw.githubusercontent.com/axsion/HyroxScraper/main/events.txt


(or local events.txt if offline)

For each event, it crawls:

https://www.hyresult.com/ranking/<slug>-hyrox-<event-type>?ag=<age-group>


Podium results are stored locally on the server in:

masters.json


/api/masters serves structured JSON output to Google Sheets.

API Endpoints
Endpoint	Description
/api/health	Returns cached stats and last update time
/api/check-events	Shows all known event slugs
/api/scrape?slug=<slug>	Crawl a single event (SOLO + DOUBLES)
/api/scrape-all	Crawl all events from events.txt
/api/masters	Returns normalized data for Google Sheets
Adding New HYROX Events (Most Important)
1️⃣ Identify the event slug

Open any podium page, example:

https://www.hyresult.com/ranking/s8-2025-calgary-hyrox-men


Slug =

s8-2025-calgary

2️⃣ Add it to events.txt (one per line)
s8-2025-calgary
s8-2025-lisbon
s7-2025-kansas-city


Commit + push to GitHub.

3️⃣ Start the crawl

Run:

https://hyroxscraper.fly.dev/api/scrape-all


or only the new event:

https://hyroxscraper.fly.dev/api/scrape?slug=s8-2025-calgary

4️⃣ Update Google Sheets

In Google Sheets, run:

updateSheets()


✅ Done — both Solo and Doubles sheets will rewrite cleanly.

Google Sheets Integration

Your Apps Script should contain:

const BASE_URL = "https://hyroxscraper.fly.dev";
const SOLO_SHEET = "Solo-2025";
const DOUBLES_SHEET = "Doubles-2025";

const HEADERS = [
  "Event","City","Date","Category","Gender",
  "Gold","Time1","Silver","Time2","Bronze","Time3"
];

function fetchMasters() {
  const r = UrlFetchApp.fetch(`${BASE_URL}/api/masters`, { muteHttpExceptions: true });
  return JSON.parse(r.getContentText()).rows || [];
}

function writeToSheet(name, rows) {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  let sheet = ss.getSheetByName(name);
  if (!sheet) sheet = ss.insertSheet(name);

  sheet.clearContents();
  sheet.getRange(1,1,1,HEADERS.length).setValues([HEADERS]);

  if (rows.length) {
    sheet.getRange(2,1,rows.length,HEADERS.length)
      .setValues(rows.map(r => HEADERS.map(h => r[h] ?? "")));
  }
}

function updateSheets() {
  const rows = fetchMasters();
  writeToSheet(SOLO_SHEET, rows.filter(r => r.Gender === "MEN" || r.Gender === "WOMEN"));
  writeToSheet(DOUBLES_SHEET, rows.filter(r => r.Gender.startsWith("DOUBLES")));
}

✅ No need to manually clear any Sheet

The script clears and rebuilds them automatically.

Deployment (Fly.io)
1. Install Fly CLI
brew install flyctl

2. Login
flyctl auth login

3. Deploy
flyctl deploy

4. View logs
flyctl logs

Your Manual Update Workflow (Keep This Forever)
Step	Action	Example
1	New HYROX event finishes	See podium page on hyresult.com
2	Add event slug to events.txt	s8-2025-calgary
3	Crawl data	https://hyroxscraper.fly.dev/api/scrape-all
4	Update Google Sheets	Run updateSheets()

No automation.
No duplicates.
No cleanup needed.
Always clean master data. ✅

Author

Inside HYROX Canada / ROX50 Masters
Data-driven podium intelligence for the Masters HYROX community.
