# Merge crawler output into one numbered inventory: drop data-only text, map
# each block to its source line, fold template variants of the same caption
# into one entry, and crop a highlighted screenshot for each.
import json, glob, re, os, io, html, difflib
from PIL import Image, ImageDraw

OUT = "desloppify/out"
TAB_ORDER = ["EXPLORE", "2025-26", "2024-25", "2023-24", "DRAFT", "LEGACY", "COLLEGE", "D RATING", "USAGE", "SHOT ZONES", "INFO"]
tab_rank = lambda t: TAB_ORDER.index(t) if t in TAB_ORDER else 99

blocks = []
for f in glob.glob(f"{OUT}/*.json"):
    if os.path.basename(f) in ("source-strings.json", "inventory.json", "unreached.json", "unreached-raw.json"):
        continue
    blocks += json.load(open(f))

# ---- source index: every client file, whitespace-normalized, with line map
SRC_FILES = sorted(glob.glob("app/components/**/*.js", recursive=True)) + ["app/tracker.js", "app/lib/legacy.js", "app/lib/format.js", "app/lib/va.js", "app/lib/multi-season.js", "app/lib/positions.js", "app/scoring.js", "app/historical.js"]
ENT = {"&apos;": "'", "&rsquo;": "’", "&lsquo;": "‘", "&ldquo;": "“", "&rdquo;": "”", "&quot;": '"', "&amp;": "&", "&nbsp;": " ", "&mdash;": "—", "&ndash;": "–", "&hellip;": "…", "&times;": "×", "&middot;": "·", "&lambda;": "λ", "&ge;": "≥", "&le;": "≤", "&minus;": "−", "{\" \"}": " "}
index = []
for f in SRC_FILES:
    if not os.path.exists(f):
        continue
    raw = open(f).read()
    chars, lines = [], []
    ln = 1
    i = 0
    while i < len(raw):
        hit = next((k for k in ENT if raw.startswith(k, i)), None)
        if hit:
            for ch in ENT[hit]:
                chars.append(ch); lines.append(ln)
            i += len(hit); continue
        ch = raw[i]
        if ch == "\n":
            ln += 1
        if ch.isspace():
            if chars and chars[-1] != " ":
                chars.append(" "); lines.append(ln)
        else:
            chars.append(ch.lower()); lines.append(ln)
        i += 1
    index.append((f, "".join(chars), lines))

WORD = re.compile(r"[A-Za-z’'\-]+")
def locate(text):
    words = text.split()
    windows = []
    for i in range(len(words) - 2):
        w = words[i:i + 3]
        if all(WORD.fullmatch(x.strip(".,;:()·—")) for x in w):
            windows.append(" ".join(w).lower())
    if not windows:
        windows = [text.lower()[:30]] if len(text) >= 12 else []
    best = None
    for f, s, lines in index:
        hits = []
        for w in windows:
            k = s.find(w)
            if k >= 0:
                hits.append(lines[k])
        if hits and (best is None or len(hits) > best[0]):
            hits.sort()
            best = (len(hits), f, hits[len(hits) // 2])
    if best and best[0] >= max(1, len(windows) // 4):
        return f"{best[1]}:{best[2]}"
    return None

def norm(t):
    return re.sub(r"\s+", " ", re.sub(r"[\d.,%+−\-]+", "#", t)).strip().lower()

def is_data(b):
    t = b["text"]
    words = [w for w in t.split() if re.search(r"[a-z]{2}", w)]
    if "truncate" in b.get("cls", ""):
        return True
    if len(words) < 4:
        return True
    letters = sum(c.isalpha() for c in t)
    if letters < 0.35 * len(t):
        return True
    return False

blocks = [b for b in blocks if not is_data(b)]
blocks.sort(key=lambda b: (tab_rank(b["tab"]), b["state"].count(">"), b["y"]))

items, by_key = [], {}
for b in blocks:
    k = norm(b["text"])
    if k in by_key:
        by_key[k]["tabs"].add(b["tab"]); continue
    b["src"] = locate(b["text"])
    # fold into an existing entry from the same source line when it is a template variant
    twin = None
    for it in items:
        r = difflib.SequenceMatcher(None, norm(it["text"]), k).ratio()
        if (b["src"] and it["src"] == b["src"] and r > 0.55) or r > 0.85:
            twin = it; break
    if twin:
        twin["variants"].append(b["text"]); twin["tabs"].add(b["tab"]); by_key[k] = twin
        continue
    b["tabs"] = {b["tab"]}
    b["variants"] = []
    items.append(b); by_key[k] = b

items.sort(key=lambda b: (tab_rank(b["tab"]), b["state"].count(">"), b["src"] or "zzz", b["y"]))

os.makedirs(f"{OUT}/crops", exist_ok=True)
for i, b in enumerate(items, 1):
    b["id"] = f"T{i:03d}"
    b["also"] = sorted(b["tabs"] - {b["tab"]}, key=tab_rank)
    del b["tabs"]
    try:
        im = Image.open(f'{OUT}/shots/{b["shot"]}').convert("RGB")
        pad = 80
        top, bot = max(0, b["y"] - pad), min(im.height, b["y"] + b["h"] + pad)
        crop = im.crop((0, top, im.width, bot)).copy()
        d = ImageDraw.Draw(crop)
        y0 = b["y"] - top
        d.rectangle((max(0, b["x"] - 4), y0 - 4, min(im.width - 1, b["x"] + b["w"] + 4), y0 + b["h"] + 4), outline=(225, 45, 30), width=3)
        crop.save(f'{OUT}/crops/{b["id"]}.jpg', "JPEG", quality=70)
        b["crop"] = f'crops/{b["id"]}.jpg'
    except Exception:
        b["crop"] = None

json.dump(items, open(f"{OUT}/inventory.json", "w"), indent=1, ensure_ascii=False)
print(len(blocks), "text blocks ->", len(items), "entries;", sum(1 for b in items if not b["src"]), "without a source match")
