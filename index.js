/**
 * HYROX Scraper v28.2 — Render-Safe Full Recrawl Edition
 * -------------------------------------------------------
 * ✅ Auto-discovers all past events from /events?tab=past
 * ✅ Crawls Solo + Doubles (Men / Women / Mixed)
 * ✅ Masters + legacy S7 age groups
 * ✅ Auto-installs Chromium (no sudo)
 * ✅ 100 % compatible with Google Sheets v28 integration
 */

import express from "express";
import fs from "fs";
import path from "path";
import { chromium } from "playwright";
import { execSync } from "child_process";

const app = express();
const PORT = process.env.PORT || 1000;

// ──────────────────────────────────────────────
// Cache setup
// ──────────────────────────────────────────────
const DATA_DIR = path.join(process.cwd(), "data");
const LAST_RUN_FILE = path.join(DATA_DIR, "last-run.json");
if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });

let cache = { events: [] };
if (fs.existsSync(LAST_RUN_FILE)) {
  try {
    cache = JSON.parse(fs.readFileSync(LAST_RUN_FILE, "utf8"));
    console.log(`✅ Loaded ${cache.events.length} cached events.`);
  } catch {
    console.warn("⚠️ Corrupt cache — starting fresh.");
  }
} else {
  console.log("ℹ️ No cache found — starting fresh.");
}

app.use(express.json({ limit: "10mb" }));

// ──────────────────────────────────────────────
// Ensure Chromium (Render-safe, user-space only)
// ──────────────────────────────────────────────
try {
  const PW_DIR = process.env.PLAYWRIGHT_BROWSERS_PATH || "/opt/render/project/.playwright";
  const chromiumPath = path.join(PW_DIR, "chromium");
  if (!fs.existsSync(chromiumPath)) {
    console.log("🧩 Installing user-space Chromium...");
    execSync("PLAYWRIGHT_BROWSERS_PATH=/opt/render/project/.playwright npx playwright install chromium", { stdio: "inherit" });
    console.log("✅ Chromium installed in user space.");
  } else {
    console.log("✅ Chromium already installed.");
  }
} catch (err) {
  console.warn("⚠️ Chromium install skipped:", err.message);
}

// ──────────────────────────────────────────────
// Constants & helpers
// ──────────────────────────────────────────────
const MASTER_AGS_S8 = ["45-49","50-54","55-59","60-64","65-69","70-74","75-79"];
const MASTER_AGS_S7 = ["50-59","60-69"];

const normalize = s => (s || "").replace(/\s+/g, " ").trim();
const looksLikeTime = s => /^\d{1,2}:\d{2}(:\d{2})?$/.test(s);

function yearFromSlug(slug){ return slug.match(/s\d{1,2}-(\d{4})-/i)?.[1] || "2025"; }
function cityFromSlug(slug){ return slug.match(/s\d{1,2}-\d{4}-([a-z-]+)-hyrox/i)?.[1].replace(/-/g," ").toUpperCase() || "UNKNOWN"; }

function saveCache(){ fs.writeFileSync(LAST_RUN_FILE, JSON.stringify(cache,null,2)); }
function addUnique(event){
  const key=`${event.eventName}_${event.category}_${event.type}`;
  if(cache.events.some(e=>`${e.eventName}_${e.category}_${e.type}`===key)) return false;
  cache.events.push(event); saveCache(); return true;
}

// ──────────────────────────────────────────────
// URL builders
// ──────────────────────────────────────────────
function ageGroupsFor(slug){ return /^s7-/.test(slug)?[...MASTER_AGS_S8,...MASTER_AGS_S7]:MASTER_AGS_S8; }

function baseUrlsFor(slug){
  return [
    {url:`https://www.hyresult.com/ranking/${slug}-men`,type:"Solo",gender:"Men"},
    {url:`https://www.hyresult.com/ranking/${slug}-women`,type:"Solo",gender:"Women"},
    {url:`https://www.hyresult.com/ranking/${slug}-doubles-men`,type:"Double",gender:"Men"},
    {url:`https://www.hyresult.com/ranking/${slug}-doubles-women`,type:"Double",gender:"Women"},
    {url:`https://www.hyresult.com/ranking/${slug}-doubles-mixed`,type:"Double",gender:"Mixed"}
  ];
}

function buildUrls(slugs){
  const out=[];
  for(const slug of slugs){
    const ags=ageGroupsFor(slug);
    for(const base of baseUrlsFor(slug)){
      for(const ag of ags){
        out.push({...base,slug,ag,url:`${base.url}?ag=${encodeURIComponent(ag)}`});
      }
    }
  }
  return out;
}

// ──────────────────────────────────────────────
// Scrape podium
// ──────────────────────────────────────────────
async function scrapePodium(url,{type}){
  const browser=await chromium.launch({headless:true,args:["--no-sandbox","--disable-dev-shm-usage"]});
  const page=await browser.newPage();
  try{
    await page.goto(url,{waitUntil:"networkidle",timeout:60000});
    await page.waitForTimeout(800);
    const rows=await page.$$eval("table tbody tr",trs=>{
      const looksLikeTime=t=>/^\d{1,2}:\d{2}(:\d{2})?$/.test(t);
      const isNameish=t=>/[A-Za-zÀ-ÿ]/.test(t)&&!looksLikeTime(t)&&!/^\d+$/.test(t);
      return trs.slice(0,3).map(tr=>{
        const tds=[...tr.querySelectorAll("td")].map(td=>td.innerText.trim());
        const names=tds.filter(isNameish);
        const name=names.slice(0,2).join(", ");
        const time=tds.find(looksLikeTime)||"";
        return{name,time};
      }).filter(r=>r.name&&r.time);
    });
    await browser.close();
    return rows.length?rows:null;
  }catch(e){await browser.close();console.error(`❌ ${url}: ${e.message}`);return null;}
}

// ──────────────────────────────────────────────
// Discover past event slugs directly from API
// ──────────────────────────────────────────────
async function discoverPastSlugs() {
  console.log("🌐 Discovering past events via Hyresult API...");
  try {
    const res = await fetch("https://www.hyresult.com/api/events?tab=past");
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();
    const slugs = data
      .map(e => e.slug)
      .filter(slug => /^s\d{1,2}-\d{4}-[a-z-]+-hyrox$/.test(slug))
      .map(slug => slug.replace(/-hyrox$/, ""));
    console.log(`🌍 Found ${slugs.length} event slugs`);
    return [...new Set(slugs)];
  } catch (err) {
    console.error("❌ Slug discovery failed:", err.message);
    return [];
  }
}

// ──────────────────────────────────────────────
// Crawl batch
// ──────────────────────────────────────────────
async function scrapeBatch(defs){
  let added=0;
  for(const d of defs){
    const{url,slug,type,gender,ag}=d;
    console.log(`🔎 ${url}`);
    const podium=await scrapePodium(url,{type});
    if(!podium) continue;
    const city=cityFromSlug(slug);
    const year=yearFromSlug(slug);
    const eventName=`Ranking of ${year} ${city} HYROX ${type.toUpperCase()} ${gender.toUpperCase()}`;
    const event={eventName,city,year,category:ag,gender,type,podium,url};
    if(addUnique(event)){added++;console.log(`✅ Added ${eventName} (${ag})`);}
    else console.log(`⏩ Skipped cached ${eventName} (${ag})`);
    await new Promise(r=>setTimeout(r,200));
  }
  console.log(`🎯 Completed scrape — ${added} new events.`);
  return added;
}

// ──────────────────────────────────────────────
// Routes
// ──────────────────────────────────────────────
app.get("/",(_req,res)=>res.send("✅ HYROX Scraper v28.2 — Render Stable"));
app.get("/api/health",(_req,res)=>res.json({ok:true}));

app.get("/api/last-run",(_req,res)=>{
  if(!fs.existsSync(LAST_RUN_FILE)) return res.status(404).json({error:"No cache"});
  res.sendFile(LAST_RUN_FILE);
});

app.get("/api/clear-cache",(_req,res)=>{
  if(fs.existsSync(LAST_RUN_FILE)) fs.unlinkSync(LAST_RUN_FILE);
  cache={events:[]}; res.json({status:"cleared"});
});

app.post("/api/set-initial-cache",(req,res)=>{
  const{events}=req.body;
  if(!Array.isArray(events)) return res.status(400).json({error:"Invalid payload"});
  cache.events=events; saveCache();
  res.json({status:"✅ Cache restored",count:events.length});
});

app.get("/api/scrape-all",async(_req,res)=>{
  try{
    const slugs=await discoverPastSlugs();
    const defs=buildUrls(slugs);
    const added=await scrapeBatch(defs);
    res.json({added,totalCache:cache.events.length});
  }catch(e){res.status(500).json({error:e.message});}
});

app.get("/api/scrape-latest",async(_req,res)=>{
  try{
    const slugs=await discoverPastSlugs();
    const latest=slugs.slice(-2);
    console.log("🆕 Latest slugs:",latest);
    const defs=buildUrls(latest);
    const added=await scrapeBatch(defs);
    res.json({added,totalCache:cache.events.length});
  }catch(e){res.status(500).json({error:e.message});}
});

// ──────────────────────────────────────────────
app.listen(PORT,()=>console.log(`🔥 HYROX Scraper v28.2 running on port ${PORT}`));
