# Source strings of 8+ words whose wording never showed up in any crawled
# text block: candidates for text that only renders in states the crawl
# didn't reach. Printed for manual curation.
import json, glob, re, os

OUT = "desloppify/out"
seen_text = []
for f in glob.glob(f"{OUT}/*.json"):
    if os.path.basename(f) in ("source-strings.json", "inventory.json", "unreached.json", "unreached-raw.json"):
        continue
    seen_text += [b["text"].lower() for b in json.load(open(f))]
blob = "\n".join(seen_text)

ENT = {"&apos;": "'", "&rsquo;": "’", "&lsquo;": "‘", "&ldquo;": "“", "&rdquo;": "”", "&quot;": '"', "&amp;": "&", "&nbsp;": " ", "&mdash;": "—", "&hellip;": "…"}
src = json.load(open(f"{OUT}/source-strings.json"))
out = []
for s in src:
    if s["kind"] == "aria":
        continue
    t = s["t"]
    for k, v in ENT.items():
        t = t.replace(k, v)
    t = re.sub(r"\s+", " ", t)
    pieces = [p.strip() for p in re.split(r"\$\{[^}]*\}|\{[^}]*\}", t)]
    static = " ".join(p for p in pieces if p)
    words = [w for w in static.split() if re.search(r"[a-z]{2}", w)]
    if len(words) < 8 or re.search(r"=>|&&|\|\||className|\breturn\b|;\s*$", t):
        continue
    frags = [p.lower() for p in pieces if len(p) >= 14]
    if frags and all(fr in blob for fr in frags):
        continue
    out.append({"src": f'{s["f"]}:{s["l"]}', "kind": s["kind"], "text": t})

json.dump(out, open(f"{OUT}/unreached-raw.json", "w"), indent=1, ensure_ascii=False)
for o in out:
    print(o["src"], o["kind"], "|", o["text"][:200])
print(len(out))
