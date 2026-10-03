# Renders desloppify/out/inventory.json (+ the unreached source strings) into
# a single self-contained review page with a replacement box per entry.
import json, base64, html, os

OUT = "desloppify/out"
items = json.load(open(f"{OUT}/inventory.json"))
extra = json.load(open("desloppify/unreached.json"))

TAB_NAMES = {"EXPLORE": "Explore", "2025-26": "2025-26", "2024-25": "2024-25", "2023-24": "2023-24", "DRAFT": "Draft",
             "LEGACY": "Legacy", "COLLEGE": "College", "D RATING": "D Rating", "USAGE": "Usage", "SHOT ZONES": "Shot Zones", "INFO": "Info"}

def crop_uri(b):
    if not b.get("crop"):
        return None
    return "data:image/jpeg;base64," + base64.b64encode(open(f'{OUT}/{b["crop"]}', "rb").read()).decode()

entries = []
START = {"EXP_ROOT": ["Explore"], "EXP_ROW": ["Explore", "player card open"], "EXP_PO_ROW": ["Explore", "Playoffs", "player card open"],
         "EXP_CMP": ["Explore", "player card", "Compare"], "EXP_CAT": ["Explore", "player card", "By Category"],
         "EXP_CTX": ["Explore", "player card", "Scoring context card"], "EXP_PLAYER": ["Explore", "By Player", "LeBron James"]}
def short(x):
    x = x.replace("▸", "").replace("▾", "").strip()
    return x if len(x) <= 32 else x[:30].rstrip() + "…"
for b in items:
    parts = b["state"].split(" > ")
    path = START.get(parts[0], [TAB_NAMES.get(b["tab"], b["tab"])]) + [short(x) for x in parts[1:]]
    entries.append({
        "id": b["id"], "tab": TAB_NAMES.get(b["tab"], b["tab"]), "text": b["text"], "lines": b["lines"],
        "path": path, "src": b.get("src"), "img": crop_uri(b), "also": [TAB_NAMES.get(t, t) for t in b.get("also", [])],
        "variants": b.get("variants", [])[:6], "nvar": len(b.get("variants", [])),
    })
n = {"screen": 0, "tooltip": 0}
for e in extra:
    n[e["kind"]] += 1
    pre, group = ("S", "Only in states the crawl didn’t reach") if e["kind"] == "screen" else ("H", "Hover tooltips")
    entries.append({"id": f"{pre}{n[e['kind']]:02d}", "tab": group, "text": e["text"], "lines": None,
                    "path": [e["when"]], "src": e["src"], "img": None, "also": []})

DATA = json.dumps(entries, ensure_ascii=False).replace("</", "<\\/")
tpl = open("desloppify/page.tpl.html").read()
open("desloppify/review.html", "w").write(tpl.replace("/*__DATA__*/[]", DATA))
print(len(entries), "entries;", round(os.path.getsize("desloppify/review.html") / 1e6, 2), "MB")
