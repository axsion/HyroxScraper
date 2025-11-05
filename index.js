/**
 * HYROX SCRAPER - Master Categories Only (45+)
 * Fast, stable, no headless browser required.
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

function parseMeta(url) {
  const slug = slugFromUrl(url);
  const year = slug.match(/s\d-(\d{4})-/)?.[1] ?? "";
  const cityPart = slug.match(/\d{4}-([a-z0-9-]+)-hyrox-/i)?.[1] ?? "";
  const city = cityPart.split("-").map(s => s[0].toUpperCase() + s.slice(1)).join(" ");
  const gender = /hyrox-women/i.test(slug) ? "WOMEN" : "MEN";
  const eventTitle = `Ranking of ${year} ${city} HYROX ${gender}`;
  return { slug, year, city, gender, eventTitle };
}

function buildRow({ eventTitle, city, year, cat, gender, podium }) {
  const epc = `${eventTitle}${cat}`;
  const [g = {}, s = {}, b = {}] = podium;
  return [
    epc, eventTitle, city, year, cat, gender,
    g.name || "", g.time || "",
    s.name || "", s.time || "",
    b.name || "", b.time || ""
  ];
}

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

function extractAgeCategories(html) {
  const cats = new Set();
  const re = /\b(4[5-9]-\d{2}|5[0-9]-\d{2}|6[0-9]-\d{2}|7[0-9]-\d{2}|8[0-9]-\d{2})\b/g;
  let m;
  while ((m = re.exec(html))) cats.add(m[1]);
  return [...cats];
}

function parsePodiumFromTable(html) {
  const $ = cheerio.load(html);
  const rows = $("table tbody tr").slice(0, 3);
  const out = [];
  rows.each((_, tr) => {
    const cells = $(tr).find("td, th").map((_, td) => $(td).text().trim()).get();
    const time = cells.find(t => /\d{1,2}:\d{2}(:\d{2})?$/.test(t)) || "";
    const name = cells.filter(t => t && !/^\d+$/.test(t) && !/\d{1,2}:\d{2}/.test(t))
      .sort((a, b) => b.length - a.length)[0] || "";
    if (name || time) out.push({ name, time });
  });
  return out.length === 3 ? out : [];
}

async function scrapeEvent(url, { force = false } = {}) {
  const meta = parseMeta(url);
  const progress = readScraped();
  const prev = progress[meta.slug];

  if (prev && prev.status === "complete" && !force)
    return { meta, skipped: true, rows: [] };

  const baseHtml = await fetchHtml(url);
  const cats = extractAgeCategories(baseHtml);
  const rows = [];

  for (const cat of cats) {
    const catUrl = url.includes("?")
      ? `${url}&ag=${cat}`
      : `${url}?ag=${cat}`;
    const catHtml = await fetchHtml(catUrl);
    const podium = parsePodiumFromTable(catHtml);
    if (podium.length === 3)
      rows.push(buildRow({ eventTitle: meta.eventTitle, city: meta.city, year: meta.year, cat, gender: meta.gender, podium }));
  }

  if (rows.length > 0) {
    progress[meta.slug] = { status: "complete", last_scraped: new Date().toISOString() };
    writeScraped(progress);
  }

  return { meta, skipped: false, rows };
}

app.get("/api/health", (_req, res) => res.json({ ok: true }));

app.get("/api/check-events", async (_req, res) => {
  const txt = await fetch(EVENTS_TXT_URL).then(r => r.text());
  const urls = txt.split(/\r?\n/).filter(l => l.startsWith("http"));
  const progress = readScraped();
  res.json(urls.map(u => {
    const slug = slugFromUrl(u);
    return { slug, url: u, status: progress[slug]?.status || "pending" };
  }));
});

app.get("/api/scrape-all", async (req, res) => {
  const force = req.query.force === "true";
  const txt = await fetch(EVENTS_TXT_URL).then(r => r.text());
  const urls = txt.split(/\r?\n/).filter(l => l.startsWith("http"));

  let allRows = [];
  let results = [];

  for (const u of urls) {
    try {
      const r = await scrapeEvent(u, { force });
      results.push({ slug: r.meta.slug, produced: r.rows.length });
      allRows.push(...r.rows);
    } catch (e) {
      results.push({ slug: slugFromUrl(u), error: String(e) });
    }
  }

  res.json({
    results,
    total_rows: allRows.length,
    rows: allRows,
    columns: ["Event plus Cat","Event","City","Date","Category","Gender","Gold","Time1","Silver","Time2","Bronze","Time3"]
  });
});

app.listen(PORT, () => console.log("✅ HYROX MASTER SCRAPER RUNNING ON PORT", PORT));
