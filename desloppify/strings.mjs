// Pull every prose-looking string out of the client source (JSX text and string
// literals), skipping comments and Tailwind class lists.
import fs from "node:fs";
const files = [...fs.readdirSync("app/components").map(f=>"app/components/"+f).filter(f=>f.endsWith(".js")), "app/components/ui/sparkline.js","app/tracker.js","app/layout.js","app/page.js","app/lib/format.js","app/lib/legacy.js","app/lib/va.js","app/lib/positions.js","app/lib/players.js","app/lib/leverage.js","app/lib/multi-season.js","app/lib/gated-go.js","app/lib/draft-model.js","app/lib/defense.js","app/scoring.js","app/historical.js","app/teams.js"];
const out=[];
const tw = { test: (s) => s.trim().split(/\s+/).every((w) => /^[\w:\/\[\]\.\-#%()!]*$/.test(w)) };
const isClass = (s)=> /\b(text-|bg-|border|px-|py-|flex|grid|mt-|mb-|w-|h-|gap-|rounded|font-|tracking|uppercase|items-|justify)/.test(s) && tw.test(s);
for (const f of files) {
  let src = fs.readFileSync(f,"utf8");
  // blank out comments preserving line numbers
  src = src.replace(/\/\*[\s\S]*?\*\//g, m=>m.replace(/[^\n]/g," ")).replace(/(^|[^:"'`\\])\/\/[^\n]*/g,(m,p)=>p+" ".repeat(m.length-p.length));
  src = src.replace(/\{\/\*[\s\S]*?\*\/\}/g, m=>m.replace(/[^\n]/g," "));
  const lineOf = (i)=> src.slice(0,i).split("\n").length;
  // JSX text
  for (const m of src.matchAll(/>([^<>]*[A-Za-z][^<>]*)</g)) {
    const t=m[1].replace(/\s+/g," ").trim(); if (t.split(" ").length>=3 && !/[=;]|=>|&&/.test(t)) out.push({f,l:lineOf(m.index),kind:"jsx",t});
  }
  for (const m of src.matchAll(/(["'`])((?:\\.|(?!\1)[^\\\n])*?)\1/g)) {
    const t=m[2];
    const before = src.slice(Math.max(0, m.index - 40), m.index);
    const attr = (before.match(/([\w-]+)=\{?\s*(?:[^=]*\?\s*)?$/) || [])[1] || "";
    if (/^(className|key|style|d|href|viewBox|fill|stroke)$/.test(attr)) continue;
    if (/(console\.|throw new Error|new Error)\s*\($/.test(before.trim()) || /console\.\w+\($/.test(before.trim())) continue;
    if (t.split(" ").length>=4 && /[a-z]{3}/.test(t) && !isClass(t) && !/^[\w\-\/\.]+$/.test(t)) out.push({f,l:lineOf(m.index),kind: attr === "aria-label" ? "aria" : attr === "title" ? "tooltip" : attr === "placeholder" ? "placeholder" : "str",t});
  }
}
fs.writeFileSync("desloppify/out/source-strings.json",JSON.stringify(out,null,1));
console.log(out.length);
