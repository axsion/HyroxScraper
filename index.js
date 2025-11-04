/**
 * HYROX Scraper v4.2 – Fly.io stable build
 * ----------------------------------------
 * ✅ Listens on 0.0.0.0:10000 (Fly health OK)
 * ✅ Masters categories only (45-49 → 80-84)
 * ✅ Works with lightweight Docker + Playwright@1.56.1
 * ✅ Caches crawled URLs under /data
 * ✅ Logs all runs under /data/logs
 * ✅ Endpoints:
 *    /api/health        – health check
 *    /api/check-events  – show all expanded event URLs
 *    /api/check-new     – show uncrawled URLs
 *    /api/scrape        – scrape one ?url=
 *    /api/scrape-all    – crawl all (background)
 *    /api/progress      – job status
 *    /api/logs          – recent log lines
 */

import express from "express";
import * as cheerio from "cheerio";
import { chromium } from "playwright";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PORT = Number(process.env.PORT || 10000);
const APP_NAME = "HYROX Scraper v4.2";

// --------------------  Directories & files  --------------------
const DATA_DIR = "/data";
const LOG_DIR = path.join(DATA_DIR, "logs");
const RESULTS_DIR = path.join(DATA_DIR, "results");
const CACHE_FILE = path.join(DATA_DIR, "last-scraped.json");
const LAST_RUN_FILE = path.join(DATA_DIR, "last-run.json");
for (const d of [DATA_DIR, LOG_DIR, RESULTS_DIR]) fs.mkdirSync(d, { recursive: true });

// --------------------  URLs & constants  --------------------
const EVENTS_URL = "https://raw.githubusercontent.com/axsion/HyroxScraper/main/events.txt";
const MASTER_AGS = ["45-49","50-54","55-59","60-64","65-69","70-74","75-79","80-84"];
const SOLO = ["hyrox-men","hyrox-women"];
const DOUBLES = ["hyrox-doubles-men","hyrox-doubles-women","hyrox-doubles-mixed"];

// low-memory chromium flags for Fly.io
const CHROMIUM_ARGS = [
  "--no-sandbox","--disable-setuid-sandbox","--disable-dev-shm-usage",
  "--single-process","--disable-gpu","--no-zygote"
];

// --------------------  Helpers  --------------------
const todayStamp = () => {
  const d = new Date(), z = (n) => String(n).padStart(2, "0");
  return `${d.getUTCFullYear()}${z(d.getUTCMonth()+1)}${z(d.getUTCDate())}`;
};
const logFile = path.join(LOG_DIR, `scraper-${todayStamp()}.txt`);
function appendLog(line){
  const msg = `[${new Date().toISOString()}] ${line}\n`;
  process.stdout.write(msg);
  fs.appendFileSync(logFile, msg);
}
function readJSON(file,fallback){ try{return JSON.parse(fs.readFileSync(file,"utf8"));}catch{return fallback;} }
function writeJSON(file,obj){ try{fs.writeFileSync(file,JSON.stringify(obj,null,2));}catch(e){appendLog("⚠️ "+e.message);} }

// --------------------  Job state  --------------------
let job={running:false,queued:0,done:0,succeeded:0,failed:0,lastUrl:null,lastError:null,startedAt:null,finishedAt:null};
setInterval(()=>{ if(job.running) appendLog(`💓 heartbeat – queued:${job.queued} done:${job.done} ok:${job.succeeded} fail:${job.failed}`); },5000);

// --------------------  Event expansion  --------------------
async function fetchBaseEvents(){
  const res=await fetch(EVENTS_URL,{cache:"no-store"});
  const txt=await res.text();
  return txt.split("\n").map(x=>x.trim()).filter(x=>x.startsWith("http"));
}
function expandEvents(bases){
  const urls=[];
  for(const base of bases){
    for(const ag of MASTER_AGS){
      for(const div of SOLO) urls.push(`${base}-${div}?ag=${ag}`);
      for(const div of DOUBLES) urls.push(`${base}-${div}?ag=${ag}`);
    }
  }
  return urls;
}

// --------------------  Scraper  --------------------
async function scrapeOne(url){
  job.lastUrl=url;
  appendLog(`🔎 Opening ${url}`);
  const browser=await chromium.launch({headless:true,args:CHROMIUM_ARGS});
  try{
    const page=await browser.newPage();
    await page.goto(url,{waitUntil:"domcontentloaded",timeout:60000});
    await page.waitForTimeout(1000);
    const html=await page.content();
    const $=cheerio.load(html);
    const title=$("h1").first().text().trim()||$("title").text().trim();
    const rows=[];
    $("table tr").each((_,tr)=>{
      const tds=$(tr).find("td");
      if(tds.length>=3){
        const pos=$(tds[0]).text().trim();
        if(/^[123]\.?$/.test(pos)) rows.push(tds.map((i,td)=>$(td).text().trim()).get());
      }
    });
    if(rows.length<3) return {success:false,meta:{url,title},error:"No podium rows"};
    const fmt=(r)=>({pos:r[0],name:r[1],time:r[2]});
    const podium={gold:fmt(rows[0]),silver:fmt(rows[1]),bronze:fmt(rows[2])};
    return {success:true,meta:{url,title},podium};
  }catch(e){
    return {success:false,meta:{url},error:e.message};
  }finally{ await browser.close().catch(()=>{}); }
}

// --------------------  Queue runner  --------------------
async function runQueue(urls,{force=false,concurrency=1}={}){
  job.running=true; job.startedAt=new Date().toISOString();
  job.queued=urls.length; job.done=0; job.succeeded=0; job.failed=0;
  appendLog(`🚀 Starting crawl – urls:${urls.length} force:${force} concurrency:${concurrency}`);

  const cache=readJSON(CACHE_FILE,{done:[]});
  const doneSet=new Set(cache.done);
  const toRun=force?urls:urls.filter(u=>!doneSet.has(u));
  appendLog(`🧮 After filtering, will scrape: ${toRun.length}`);
  writeJSON(LAST_RUN_FILE,{startedAt:job.startedAt,totalPlanned:toRun.length,force});

  const results=[];
  for(const url of toRun){
    const res=await scrapeOne(url);
    job.done++;
    if(res.success){
      job.succeeded++; doneSet.add(url); results.push(res);
      appendLog(`✅ [${job.done}/${job.queued}] OK: ${url}`);
    }else{
      job.failed++; job.lastError=res.error;
      appendLog(`❌ [${job.done}/${job.queued}] FAIL: ${url} – ${res.error}`);
    }
  }

  writeJSON(CACHE_FILE,{done:[...doneSet]});
  writeJSON(path.join(RESULTS_DIR,`results-${todayStamp()}.json`),
            {date:new Date().toISOString(),results});
  job.finishedAt=new Date().toISOString();
  writeJSON(LAST_RUN_FILE,{startedAt:job.startedAt,finishedAt:job.finishedAt,
                           succeeded:job.succeeded,failed:job.failed,cacheSize:doneSet.size});
  appendLog(`🏁 Crawl finished – ok:${job.succeeded} fail:${job.failed} cache:${doneSet.size}`);
  job.running=false;
}

// --------------------  Express API  --------------------
const app=express();

app.get("/api/health",(_,r)=>r.json({ok:true,app:APP_NAME,now:new Date().toISOString()}));

app.get("/api/check-events",async(_,r)=>{
  try{const base=await fetchBaseEvents();const finals=expandEvents(base);
    r.json({baseCount:base.length,total:finals.length,sample:finals.slice(0,10)});
  }catch(e){r.status(500).json({error:e.message});}
});

app.get("/api/check-new",async(_,r)=>{
  try{
    const base=await fetchBaseEvents();const finals=expandEvents(base);
    const cache=readJSON(CACHE_FILE,{done:[]});
    const newOnes=finals.filter(u=>!cache.done.includes(u));
    r.json({totalRemote:finals.length,cached:cache.done.length,newEvents:newOnes.length,
      sample:newOnes.slice(0,10)});
  }catch(e){r.status(500).json({error:e.message});}
});

app.post("/api/scrape",async(req,r)=>{
  const url=req.query.url;if(!url)return r.status(400).json({error:"Missing ?url"});
  const res=await scrapeOne(url);
  if(res.success){
    const cache=readJSON(CACHE_FILE,{done:[]});const set=new Set(cache.done);
    set.add(url);writeJSON(CACHE_FILE,{done:[...set]});
  }
  r.json(res);
});

app.post("/api/scrape-all",async(req,r)=>{
  if(job.running)return r.status(409).json({running:true});
  const force=["1","true"].includes(String(req.query.force||"").toLowerCase());
  const base=await fetchBaseEvents();const finals=expandEvents(base);
  runQueue(finals,{force,concurrency:1}).catch(e=>appendLog("❌ "+e.message));
  r.status(202).json({accepted:true,planned:finals.length,force,
    note:"Background crawl started. Check /api/progress or /api/logs"});
});

app.get("/api/progress",(_,r)=>r.json(job));

app.get("/api/logs",(_,r)=>{
  if(!fs.existsSync(logFile))return r.json({lines:[]});
  const lines=fs.readFileSync(logFile,"utf8").trim().split("\n");
  r.json({file:path.basename(logFile),lines:lines.slice(-200)});
});

app.get("/",(_,r)=>r.send(`✅ ${APP_NAME} listening on ${PORT}`));

// --------------------  Start server  --------------------
app.listen(PORT,"0.0.0.0",()=>appendLog(`✅ ${APP_NAME} listening on 0.0.0.0:${PORT}`));
