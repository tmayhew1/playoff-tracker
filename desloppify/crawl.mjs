// Crawls every tab of the app at phone width, clicking every distinct control
// (BFS, replaying the path from a fresh load for each state), and records every
// text block that renders on more than one line, with a full-page screenshot of
// the state where each block first appeared.
import { chromium } from "playwright-core";
import fs from "node:fs";
import crypto from "node:crypto";

const BASE = process.env.BASE || "http://localhost:3000";
const OUT = process.env.OUT || "desloppify/out";
const TAB = process.argv[2];               // tab label, e.g. "EXPLORE"
const MAX_STATES = +(process.argv[3] || 200);
const MAX_DEPTH = +(process.argv[4] || 4);
const PER_SIG = 2;                          // clickables explored per (tag,class) signature
const W = +(process.env.W || 430);
const PREFIX = JSON.parse(process.env.PREFIX || "[]");
const NAME = process.env.NAME || TAB;
fs.mkdirSync(`${OUT}/shots`, { recursive: true });

const browser = await chromium.launch({ executablePath: "/opt/pw-browsers/chromium-1194/chrome-linux/chrome" }).catch(() => chromium.launch());
const ctx = await browser.newContext({ viewport: { width: W, height: 900 }, deviceScaleFactor: 1 });
await ctx.route(/espn\.com|nba\.com|basketball-reference/, (r) => r.abort());
const page = await ctx.newPage();
page.on("dialog", (d) => d.dismiss().catch(() => {}));

let pending = 0;
page.on("request", () => pending++);
page.on("requestfinished", () => pending--);
page.on("requestfailed", () => pending--);
async function settle() {
  // wait until no request has been in flight for 150ms (max 15s), then for any
  // "Loading…" placeholder to clear
  const t0 = Date.now();
  let quietSince = Date.now();
  while (Date.now() - t0 < 15000) {
    await page.waitForTimeout(50);
    if (pending > 0) quietSince = Date.now();
    else if (Date.now() - quietSince >= 150) break;
  }
  await page.waitForFunction(() => !/(Loading|Ranking|Checking|Syncing)[^\n]{0,40}…/.test(document.body.innerText), null, { timeout: 30000, polling: 100 }).catch(() => {});
  // and for the page text to stop changing (client-side work after the fetch)
  let last = -1;
  for (let i = 0; i < 40; i++) {
    const len = await page.evaluate(() => document.body.innerText.length).catch(() => -2);
    if (len === last) break;
    last = len;
    await page.waitForTimeout(200);
  }
}

// In-page helpers -----------------------------------------------------------
const HELPERS = () => {
  window.__clickables = () => {
    const sel = "button, a[href], select, summary, input, [role=button], [onclick]";
    const all = [...document.querySelectorAll("body *")].filter((el) => {
      if (el.closest("[data-crawl-skip]")) return false;
      const cs = getComputedStyle(el);
      if (cs.visibility === "hidden" || cs.display === "none") return false;
      const r = el.getBoundingClientRect();
      if (r.width < 2 || r.height < 2) return false;
      if (el.matches(sel)) return !el.disabled;
      if (cs.cursor === "pointer") {
        const p = el.parentElement;
        return !(p && getComputedStyle(p).cursor === "pointer");
      }
      return false;
    }).filter((el, _, arr) => !arr.some((o) => o !== el && o.contains(el) && o.matches("button, a[href], summary, [role=button]")));
    return all;
  };
  window.__describe = () => window.__clickables().map((el, i) => ({
    i,
    tag: el.tagName.toLowerCase(),
    type: el.type || "",
    sig: el.tagName + "|" + (typeof el.className === "string" ? el.className : el.getAttribute("class") || "").replace(/\d+/g, "#").slice(0, 200),
    text: (el.innerText || el.value || el.getAttribute("aria-label") || el.getAttribute("placeholder") || "").replace(/\s+/g, " ").trim().slice(0, 60),
    options: el.tagName === "SELECT" ? [...el.options].map((o) => o.value) : null,
  }));
  window.__blocks = () => {
    const out = [];
    const INLINE = new Set(["inline", "contents"]);
    const SKIP = new Set(["SCRIPT", "STYLE", "svg", "SVG", "OPTION", "SELECT", "NOSCRIPT", "TEXTAREA"]);
    // marks every element whose subtree contains a non-inline box
    const walk = (el) => {
      let blockInside = false;
      for (const k of el.children) {
        if (SKIP.has(k.tagName)) { blockInside = true; continue; }
        const d = getComputedStyle(k).display;
        const inner = walk(k);
        if (inner || !(INLINE.has(d) || k.tagName === "BR")) blockInside = true;
      }
      el.__blockInside = blockInside;
      return blockInside;
    };
    walk(document.body);
    for (const el of document.querySelectorAll("body *")) {
      if (SKIP.has(el.tagName) || el.closest("svg")) continue;
      if (el.__blockInside) continue;
      const cs = getComputedStyle(el);
      if (INLINE.has(cs.display) || cs.display === "none" || cs.visibility === "hidden") continue;
      const hasText = [...el.childNodes].some((n) => n.nodeType === 3 && n.textContent.trim());
      if (!hasText) continue;
      const range = document.createRange();
      range.selectNodeContents(el);
      const tops = [];
      for (const r of range.getClientRects()) {
        if (r.width < 1 || r.height < 1) continue;
        if (!tops.some((t) => Math.abs(t - r.top) < 4)) tops.push(r.top);
      }
      const text = el.innerText.replace(/\s+/g, " ").trim();
      if ((tops.length >= 2 && text.length > 3) || text.split(" ").length >= 8) {
        const b = el.getBoundingClientRect();
        out.push({ text, lines: tops.length, y: Math.round(b.top + scrollY), x: Math.round(b.left), w: Math.round(b.width), h: Math.round(b.height), tag: el.tagName.toLowerCase(), cls: String(el.className).slice(0, 120) });
      }
    }
    return out;
  };
};

async function load(path) {
  pending = 0;
  await page.goto(BASE, { waitUntil: "load" }).catch(() => {});
  await page.evaluate(HELPERS);
  await settle();
  // open the tab
  await page.evaluate((tab) => {
    const b = [...document.querySelectorAll("button")].find((x) => x.innerText.trim() === tab);
    b?.click();
  }, TAB);
  await settle();
  await page.evaluate(HELPERS);
  for (const st of PREFIX) {
    if (st.click) await page.getByText(st.click, { exact: true }).first().click({ timeout: 5000 });
    else if (st.clickText) await page.getByText(st.clickText).nth(st.nth || 0).click({ timeout: 5000 });
    else if (st.label) await page.getByLabel(st.label).nth(st.nth || 0).click({ timeout: 5000 });
    else if (st.fill) { await page.getByPlaceholder(st.fill).first().fill(st.value); await page.waitForTimeout(800); }
    else if (st.select) await page.locator("select").nth(st.nth || 0).selectOption(st.select);
    await settle();
  }
  await page.evaluate(HELPERS);
  for (const step of path) await act(step);
}

async function act(step) {
  await page.evaluate(HELPERS);
  const handle = await page.evaluateHandle((st) => {
    const d = window.__describe();
    const els = window.__clickables();
    const m = d.filter((c) => c.sig === st.sig && c.text === st.text);
    return m.length ? els[(m[st.nth] || m[0]).i] : null;
  }, step);
  const el = handle.asElement();
  if (!el) throw new Error("missing clickable " + JSON.stringify(step));
  if (step.kind === "select") await el.selectOption(step.value).catch(() => {});
  else if (step.kind === "fill") { await el.fill(step.value).catch(() => {}); await page.waitForTimeout(600); }
  else { await el.scrollIntoViewIfNeeded().catch(() => {}); await el.click({ timeout: 3000, force: true }).catch(() => {}); }
  await settle();
}

const norm = (t) => t.replace(/[\d.,%+−-]+/g, "#").replace(/\s+/g, " ").trim();
const blocksSeen = new Map();
const statesSeen = new Set();
const results = [];
let shotN = 0;

async function capture(path, label) {
  await page.evaluate(HELPERS);
  const body = await page.evaluate(() => document.body.innerText);
  const h = crypto.createHash("md5").update(norm(body)).digest("hex");
  if (statesSeen.has(h)) return null;
  statesSeen.add(h);
  const blocks = await page.evaluate(() => window.__blocks());
  const fresh = blocks.filter((b) => !blocksSeen.has(norm(b.text)));
  if (process.env.DEBUG) console.log("capture", label, "body", body.length, "blocks", blocks.length);
  if (process.env.SHOT_ROOT && !path.length) await page.screenshot({ path: `${OUT}/root-${NAME}.png`, fullPage: true });
  let shot = null;
  if (fresh.length) {
    shot = `${NAME.replace(/\W+/g, "_")}-${String(++shotN).padStart(3, "0")}.png`;
    await page.screenshot({ path: `${OUT}/shots/${shot}`, fullPage: true }).catch(() => {});
    for (const b of fresh) {
      blocksSeen.set(norm(b.text), true);
      results.push({ ...b, tab: TAB, state: label, shot });
    }
  }
  const controls = await page.evaluate(() => window.__describe());
  return { controls, body };
}

const queue = [{ path: [], label: NAME }];
let n = 0;
while (queue.length && n < MAX_STATES) {
  const { path, label } = queue.shift();
  n++;
  if (n % 10 === 0) console.log("progress", n, queue.length, results.length);
  try { await load(path); } catch (e) { console.error("replay failed", label, e.message); continue; }
  const st = await capture(path, label);
  if (!st || path.length >= MAX_DEPTH) continue;
  const perSig = new Map();
  const nthOf = new Map();
  for (const c of st.controls) {
    const nk = c.sig + "\u0000" + c.text;
    c.nth = nthOf.get(nk) || 0;
    nthOf.set(nk, c.nth + 1);
    // skip top tab strip & share when inside a tab (handled by separate runs)
    if (c.tag === "button" && /^(EXPLORE|DRAFT|LEGACY|COLLEGE|D RATING|USAGE|SHOT ZONES|INFO|SHARE|COPIED|\d{4}-\d{2})$/i.test(c.text) && c.sig.includes("whitespace-nowrap")) continue;
    if (/^SHARE$/i.test(c.text)) continue;
    const k = c.sig;
    const cnt = perSig.get(k) || 0;
    if (cnt >= (path.length === 0 ? PER_SIG : 1)) continue;
    perSig.set(k, cnt + 1);
    if (c.tag === "select") {
      const opts = c.options || [];
      const pick = [...new Set([opts[1], opts[Math.floor(opts.length / 2)], opts[opts.length - 1]])].filter(Boolean);
      for (const v of pick) queue.push({ path: [...path, { sig: c.sig, text: c.text, nth: c.nth, kind: "select", value: v }], label: `${label} > select[${c.text.slice(0, 20)}]=${v}` });
    } else if (c.tag === "input" && /text|search|^$/.test(c.type)) {
      for (const v of ["LeBron", "Jo", "zzqx"]) queue.push({ path: [...path, { sig: c.sig, text: c.text, nth: c.nth, kind: "fill", value: v }], label: `${label} > type "${v}"` });
    } else if (c.tag === "input" && /range|number/.test(c.type)) {
      continue;
    } else {
      queue.push({ path: [...path, { sig: c.sig, text: c.text, nth: c.nth, kind: "click" }], label: `${label} > ${c.text || c.tag}` });
    }
  }
}
fs.writeFileSync(`${OUT}/${NAME.replace(/\W+/g, "_")}.json`, JSON.stringify(results, null, 1));
console.log(NAME, "states", n, "queue left", queue.length, "blocks", results.length);
await browser.close();
