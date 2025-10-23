/**
 * HYROX Full Season Updater (self-healing)
 * - Tries /api/last-run
 * - If empty, triggers /api/scrape-all?limit=10 and polls until data exists
 * - Appends only new events (by Event Name) in podium (one-row) format
 */

const BASE_URL = "https://hyroxseasonscraper.onrender.com";
const LAST_RUN_URL = BASE_URL + "/api/last-run";
const SCRAPE_ALL_URL = BASE_URL + "/api/scrape-all?limit=10"; // adjust limit if you want
const SHEET_NAME = "Podiums";

function updateHyroxResults() {
  const sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(SHEET_NAME);
  if (!sheet) throw new Error(`Sheet "${SHEET_NAME}" not found.`);

  // 1) Ensure we have data on the backend
  const data = ensureHyroxData(); // { events: [...] }

  const events = data.events || [];
  if (!events.length) {
    Logger.log("No events found in last-run.");
    return;
  }

  // Build a set of existing event names to avoid duplicates (column A)
  const existing = new Set();
  if (sheet.getLastRow() > 0) {
    const values = sheet.getDataRange().getValues();
    // skip header
    for (let i = 1; i < values.length; i++) {
      const name = values[i][0];
      if (name) existing.add(String(name).trim());
    }
  }

  const rows = [];
  for (const ev of events) {
    const eventName = ev.eventName || "HYROX Event";
    if (existing.has(eventName)) {
      Logger.log(`⏩ Already in sheet: ${eventName}`);
      continue;
    }

    const url = ev.url || "";
    const city = extractCity(url);
    const date = extractDate(url);
    const gender = capitalize(ev.gender || "");

    const podium = ev.podium || [];
    if (podium.length < 3) {
      Logger.log(`Skipping incomplete podium: ${eventName}`);
      continue;
    }

    const [gold, silver, bronze] = podium;

    rows.push([
      eventName,
      city,
      date,
      "Elite",           // single category label for podium sheet
      gender,            // Men/Women
      gold?.name || "",
      gold?.time || "",
      silver?.name || "",
      silver?.time || "",
      bronze?.name || "",
      bronze?.time || ""
    ]);
  }

  if (!rows.length) {
    Logger.log("✅ No new podiums to add.");
    return;
  }

  // Write header if sheet empty
  if (sheet.getLastRow() === 0) {
    sheet.appendRow([
      "Event",
      "City",
      "Date",
      "Category",
      "Gender",
      "Gold",
      "Time1",
      "Silver",
      "Time2",
      "Bronze",
      "Time3"
    ]);
  }

  sheet.getRange(sheet.getLastRow() + 1, 1, rows.length, rows[0].length).setValues(rows);
  Logger.log(`✅ ${rows.length} new podium(s) added.`);
}

/**
 * Ensure backend has data:
 * - Try /api/last-run
 * - If 404 or error, hit /api/scrape-all?limit=10 then poll /api/last-run up to ~30s
 */
function ensureHyroxData() {
  // try last-run first
  let data = tryFetchJson(LAST_RUN_URL);
  if (data && data.events && data.events.length) return data;

  // trigger scrape-all
  Logger.log("Last run missing — triggering scrape-all...");
  const kick = tryFetchJson(SCRAPE_ALL_URL);
  Logger.log("Scrape-all response: " + JSON.stringify(kick));

  // poll last-run up to 10 times (3s apart)
  for (let i = 0; i < 10; i++) {
    Utilities.sleep(3000);
    data = tryFetchJson(LAST_RUN_URL);
    if (data && data.events && data.events.length) {
      Logger.log(`Last-run ready after ${ (i+1) * 3 }s`);
      return data;
    }
    Logger.log(`Waiting for last-run... (${i+1}/10)`);
  }

  throw new Error("❌ Failed to obtain last-run data after triggering scrape-all.");
}

function tryFetchJson(url) {
  try {
    const resp = UrlFetchApp.fetch(url, { muteHttpExceptions: true });
    const code = resp.getResponseCode();
    if (code !== 200) {
      Logger.log(`Fetch ${url} -> ${code}: ${resp.getContentText()}`);
      return null;
    }
    const txt = resp.getContentText();
    const json = JSON.parse(txt);
    if (json.error) {
      Logger.log(`Error in JSON from ${url}: ${json.error}`);
      return null;
    }
    return json;
  } catch (e) {
    Logger.log(`Fetch error for ${url}: ${e}`);
    return null;
  }
}

/** Helpers **/
function extractCity(url) {
  const match = url && url.match(/hyrox-([a-z\-]+)/i);
  if (!match) return "";
  const raw = match[1].split("-")[0]; // e.g. "valencia" from "...hyrox-valencia"
  return capitalize(raw);
}

function extractDate(url) {
  // expects .../ranking/s8-2025-<city>-hyrox-...
  const match = url && url.match(/s(\d{1,2})-(\d{4})/i);
  return match ? match[2] : "";
}

function capitalize(str) {
  return str ? str.charAt(0).toUpperCase() + str.slice(1) : "";
}
