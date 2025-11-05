/**
 * HYROX SCRAPER - Masters (45+) - MEN + WOMEN
 */

import express from "express";
import fetch from "node-fetch";
import * as cheerio from "cheerio";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PORT = process.env.PORT || 8080;
const app = express();

const EVENTS_TXT_URL = "https://raw.githubusercontent.com/axsion/HyroxScraper/main/events.txt";
const DATA_DIR = "/data";
const SCRAPED_PATH = path.join(DATA_DIR, "scraped.json");

if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
if (!fs.existsSync(SCRAPED_PATH)) fs.writeFileSync(SCRAPED_PATH, JSON.stringify({}, null, 2));

const readScraped = () => JSON.parse(fs.readFileSync(SCRAPED_PATH, "utf8"));
const writeScraped = (obj) => fs.writeFileSync(SCRAPED_PATH, JSON.stringify(obj, null, 2));

function slugFromUrl(url) {
  const m = url.match(/ranking\/([^/?#]+)/i);
  return m ? m[1] : url;
}

// ✅ New robust parser
function parseMeta(url) {
  const slug = slugFromUrl(url);
  const parts = slug.split("-");

  const year = parts[1];
  const gender = slug.includes("hyrox-women") ? "WOMEN" : "MEN";

  const cityParts = parts
    .slice(2)
    .filter(p => !["hyrox", "men", "women"].includes(p));

  const city = cityParts
    .map(word => word.charAt(0).toUpperCase() + word.slice(1))
    .join(" ");

  const eventTitle = `Ranking of ${year} ${city} HYROX ${gender}`;

  return { slug, year, city, gender, eventTitle };
}

// Master categories only
const MASTER_CATS = ["45-49","50-54","55-59","60-64","65-69","70-74","75-79","80-84","85-89"];

async function fetchHtml(url) {
  const res = await fetch(url, {
    headers: {
      "user-agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120 Safari/537.36",
      "accept-language": "en-US,en;q=0.9",
      "cache-control": "no-cache"
    }
  });
  return await res.text();
}

function extractAvailableCategories(html) {
  const cats = new Set();
  const re = /\b(4[5-9]-\d{2}|5[0-9]-\d{2}|6[0-9]-\d{2}|7[0-9]-\d{2}|8[0-9]-\d{2})\b/g;
  let match;
  while ((match = re.exec(html))) cats.add(match[1]);
  return [...cats];
}

function parsePodium(html) {
  const $ = cheerio.load(html);
  const rows = $("table tbody tr").slice(0, 3);
  const result = [];
  rows.each((_, tr) => {
    const cells = $(tr).find("td,th").map((_, td) => $(td).text().trim()).get();
    const time = cells.find(t => /\d{1,2}:\d{2}(:\d{2})?$/.test(t)) || "";
    const name = cells.filter(t => t && !/\d{1,2}:\d{2}/.test(t) && !/^\d+$/.test(t)).sort((a, b) => b.length - a.length)[0] || "";
    if (name || time) result.push({ name, time });
  });
  return result.length === 3 ? result : [];
}

function buildRow(meta, cat, podium) {
  return [
    `${meta.eventTitle}${cat}`,
    meta.eventTitle,
    meta.city,
    meta.year,
    cat,
    meta.gender,
    podium[0].name, podium[0].time,
    podium[1].name, podium[1].time,
    podium[2].name, podium[2].time
  ];
}

async function expandGenderVariants(url) {
  const slug = slugFromUrl(url);
  
  // Already a gender page → return as-is
  if (slug.includes("hyrox-men") || slug.includes("hyrox-women")) return [url];

  // Otherwise add both gender variants
  const base = url.replace(slug, slug);
  return [
    `${url}-hyrox-men`,
    `${url}-hyrox-women`
  ];
}

async function scrapeEvent(url, { force = false } = {}) {
  const meta = parseMeta(url);
  const progress = readScraped();

  if (progress[meta.slug]?.status === "complete" && !force)
    return { slug: meta.slug, produced: 0 };

  const baseHtml = await fetchHtml(url);
  const cats = extractAvailableCategories(baseHtml).filter(c => MASTER_CATS.includes(c));

  let rows = [];

  for (const cat of cats) {
    const catUrl = `${url}?ag=${cat}`;
    const catHtml = await fetchHtml(catUrl);
    const podium = parsePodium(catHtml);
    if (podium.length === 3)
      rows.push(buildRow(meta, cat, podium));
  }

  if (rows.length > 0)
    progress[meta.slug] = { status: "complete", last: new Date().toISOString() };
  else
    progress[meta.slug] = { status: "empty-or-failed", last: new Date().toISOString() };

  writeScraped(progress);
  return { slug: meta.slug, produced: rows.length, rows };
}

app.get("/api/health", (_, res) => res.json({ ok: true }));

app.get("/api/check-events", async (_, res) => {
  const txt = await fetch(EVENTS_TXT_URL).then(r => r.text());
  const baseUrls = txt.split(/\r?\n/).filter(l => l.trim().startsWith("http"));
  const progress = readScraped();
  const expanded = (await Promise.all(baseUrls.map(expandGenderVariants))).flat();
  res.json(expanded.map(url => {
    const slug = slugFromUrl(url);
    return { slug, url, status: progress[slug]?.status || "pending" };
  }));
});

app.get("/api/scrape-all", async (req, res) => {
  const force = req.query.force === "true";
  const txt = await fetch(EVENTS_TXT_URL).then(r => r.text());
  const baseUrls = txt.split(/\r?\n/).filter(l => l.trim().startsWith("http"));
  const expanded = (await Promise.all(baseUrls.map(expandGenderVariants))).flat();

  let allRows = [];
  let results = [];

  for (const url of expanded) {
    try {
      const r = await scrapeEvent(url, { force });
      results.push({ slug: r.slug, produced: r.produced });
      if (r.rows) allRows.push(...r.rows);
    } catch (e) {
      results.push({ slug: slugFromUrl(url), error: e.toString() });
    }
  }

  res.json({
    results,
    total_rows: allRows.length,
    rows: allRows,
    columns: ["Event plus Cat","Event","City","Date","Category","Gender","Gold","Time1","Silver","Time2","Bronze","Time3"]
  });
});

app.listen(PORT, () => console.log("✅ HYROX Masters Scraper Running on", PORT));
