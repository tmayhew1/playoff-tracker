import { ImageResponse } from "next/og";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { shareSummary, sign } from "../_lib/share-card";
import { parseShareParams } from "../../lib/share-params";
import { compareColor, teamColor } from "../../lib/format";

export const runtime = "nodejs";

// The preview image for a shared link: /api/og?<the same query as the page>.
// app/page.js points og:image here. Four cards — a player-season, a career
// (its best season's breakdown), a head-to-head compare, a season's leaders —
// and a plain title card for anything else.
//
// Fonts are the app's own (Inter, Playfair Display), shipped as files beside
// this route: the renderer's built-in face is Latin-1 only, and would print
// "Jokić" and the minus sign as boxes. Latin + Latin Extended covers every
// name in the data.

const W = 1200, H = 630;
const INK = "#1c1917", MUTED = "#78716c", FAINT = "#a8a29e", RULE = "#e7e5e4", PAPER = "#f5f5f4";
const NEG = "#dc2626";

const FONT_DIR = join(process.cwd(), "app", "api", "og", "fonts");
let fontsP = null;
function loadFonts() {
  if (!fontsP) {
    const f = (file, name, weight, style = "normal") =>
      readFile(join(FONT_DIR, file)).then((data) => ({ name, data, weight, style }));
    fontsP = Promise.all([
      f("inter-latin-400-normal.woff", "Inter", 400),
      f("inter-latin-ext-400-normal.woff", "Inter", 400),
      f("inter-latin-700-normal.woff", "Inter", 700),
      f("inter-latin-ext-700-normal.woff", "Inter", 700),
      f("inter-latin-900-normal.woff", "Inter", 900),
      f("inter-latin-ext-900-normal.woff", "Inter", 900),
      f("playfair-display-latin-900-normal.woff", "Playfair", 900),
      f("playfair-display-latin-700-italic.woff", "Playfair", 700, "italic"),
    ]).catch((e) => { fontsP = null; throw e; });
  }
  return fontsP;
}

const CAT_LABEL = {
  "Points": "Points", "3-Pointers": "3PT", "2-Pointers": "2PT", "Free Throws": "FT",
  "Assists": "Assists", "Steals": "Steals", "Blocks": "Blocks", "Turnovers": "Turnovers",
  "D Rebounds": "D Reb", "O Rebounds": "O Reb",
};

function Brand({ right = null }) {
  return (
    <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", width: "100%" }}>
      <div style={{ display: "flex", alignItems: "baseline", gap: 12 }}>
        <span style={{ fontFamily: "Playfair", fontStyle: "italic", fontWeight: 700, fontSize: 30, color: INK }}>Trey’s</span>
        <span style={{ fontSize: 16, letterSpacing: 5, color: MUTED, textTransform: "uppercase" }}>NBA Box Score</span>
        <span style={{ fontFamily: "Playfair", fontWeight: 900, fontSize: 28, color: INK, marginLeft: 6 }}>Value Added</span>
      </div>
      {right && <span style={{ fontSize: 18, letterSpacing: 3, color: MUTED, textTransform: "uppercase" }}>{right}</span>}
    </div>
  );
}

function Frame({ children, accent = INK, right = null }) {
  return (
    <div style={{ width: W, height: H, display: "flex", flexDirection: "column", background: PAPER, fontFamily: "Inter", color: INK }}>
      <div style={{ height: 12, width: "100%", background: accent, display: "flex" }} />
      <div style={{ flex: 1, display: "flex", flexDirection: "column", padding: "34px 56px 40px" }}>
        <Brand right={right} />
        <div style={{ height: 2, background: INK, width: "100%", margin: "18px 0 26px", display: "flex" }} />
        {children}
      </div>
    </div>
  );
}

// Diverging bars around a centre line, one row per category, scaled to the
// largest magnitude on the card so every row reads against the same axis.
function CatBars({ sides, max, rowH = 34 }) {
  const HALF = 190;
  const keys = sides[0].cats.map((c) => c.key);
  return (
    <div style={{ display: "flex", flexDirection: "column", width: 660 }}>
      {keys.map((k, i) => (
        <div key={k} style={{ display: "flex", alignItems: "center", height: rowH, borderBottom: i < keys.length - 1 ? `1px solid ${RULE}` : "none" }}>
          <span style={{ width: 120, fontSize: 19, color: MUTED }}>{CAT_LABEL[k] || k}</span>
          <div style={{ display: "flex", flexDirection: "column", justifyContent: "center", gap: 3, width: HALF * 2, height: rowH }}>
            {sides.map((s, j) => {
              const v = s.cats[i].perG;
              const w = max > 0 ? Math.max(2, Math.round((Math.abs(v) / max) * HALF)) : 2;
              return (
                <div key={j} style={{ display: "flex", width: HALF * 2, height: sides.length > 1 ? 10 : 16 }}>
                  <div style={{ display: "flex", justifyContent: "flex-end", width: HALF }}>
                    {v < 0 && <div style={{ width: w, background: sides.length > 1 ? s.color : NEG, opacity: sides.length > 1 ? 0.55 : 0.85, display: "flex" }} />}
                  </div>
                  <div style={{ width: 2, background: INK, display: "flex" }} />
                  <div style={{ display: "flex", width: HALF }}>
                    {v >= 0 && <div style={{ width: w, background: s.color, display: "flex" }} />}
                  </div>
                </div>
              );
            })}
          </div>
          <div style={{ display: "flex", flexDirection: "column", alignItems: "flex-end", width: 160 }}>
            {sides.map((s, j) => (
              <span key={j} style={{ fontSize: sides.length > 1 ? 16 : 20, fontWeight: 700, color: sides.length > 1 ? s.color : INK, lineHeight: 1.05 }}>
                {sign(s.cats[i].perG, 2)}
              </span>
            ))}
          </div>
        </div>
      ))}
      <span style={{ fontSize: 15, color: FAINT, marginTop: 10 }}>VA per game by category, vs. the league baseline</span>
    </div>
  );
}

function PlayerCard({ a, career = null, usg }) {
  const color = teamColor(a.team);
  const max = Math.max(...a.cats.map((c) => Math.abs(c.perG)));
  return (
    <Frame accent={color} right={a.scopeLabel + (usg ? " · USG-ADJ" : "")}>
      <div style={{ display: "flex", flex: 1 }}>
        <div style={{ display: "flex", flexDirection: "column", width: 420, paddingRight: 30 }}>
          <span style={{ fontSize: 58, fontWeight: 900, lineHeight: 1.02, letterSpacing: -1.5 }}>{a.name}</span>
          <span style={{ fontSize: 22, color: MUTED, marginTop: 12, letterSpacing: 2, textTransform: "uppercase" }}>
            {career ? `Best: ${a.season} · ${a.team}` : `${a.season} · ${a.team} · ${a.gp} G`}
          </span>
          {/* Three lines stacked. No fragments here: the renderer lays a
              fragment's children out as a row, whatever the parent says. */}
          <div style={{ display: "flex", flexDirection: "column", marginTop: "auto" }}>
            <span style={{ fontSize: 18, color: MUTED, letterSpacing: 3, textTransform: "uppercase" }}>
              {career ? `Career VA · ${career.seasons} seasons` : "Value Added"}
            </span>
            <span style={{ fontSize: career ? 76 : 86, fontWeight: 900, color, lineHeight: 1, letterSpacing: -2, marginTop: 4 }}>
              {sign(career ? career.va : a.va)}
            </span>
            <span style={{ fontSize: 24, color: INK, marginTop: 10 }}>
              {career ? `Best ${sign(a.va)} · ${sign(a.vaPerG, 2)} VA/G` : `${sign(a.vaPerG, 2)} VA/G · #${a.rank} of ${a.of}`}
            </span>
          </div>
        </div>
        <CatBars sides={[{ ...a, color }]} max={max} />
      </div>
    </Frame>
  );
}

function CompareCard({ a, b, usg }) {
  const ca = teamColor(a.team);
  const cb = compareColor(b.team, ca).color;
  const max = Math.max(...a.cats.map((c) => Math.abs(c.perG)), ...b.cats.map((c) => Math.abs(c.perG)));
  const Side = ({ p, color }) => (
    <div style={{ display: "flex", flexDirection: "column", marginBottom: 22 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
        <div style={{ width: 16, height: 16, background: color, display: "flex" }} />
        <span style={{ fontSize: 40, fontWeight: 900, lineHeight: 1.05, letterSpacing: -1 }}>{p.name}</span>
      </div>
      <span style={{ fontSize: 19, color: MUTED, letterSpacing: 2, textTransform: "uppercase", marginTop: 4, marginLeft: 28 }}>
        {`${p.season} · ${p.team} · ${p.gp} G`}
      </span>
      <span style={{ fontSize: 34, fontWeight: 900, color, marginTop: 4, marginLeft: 28 }}>{`${sign(p.vaPerG, 2)} VA/G`}</span>
    </div>
  );
  return (
    <Frame accent={ca} right={a.scopeLabel + (usg ? " · USG-ADJ" : "")}>
      <div style={{ display: "flex", flex: 1 }}>
        <div style={{ display: "flex", flexDirection: "column", width: 420, paddingRight: 30 }}>
          <Side p={a} color={ca} />
          <span style={{ fontSize: 22, color: FAINT, marginLeft: 28, marginBottom: 18, fontStyle: "italic" }}>vs.</span>
          <Side p={b} color={cb} />
        </div>
        <CatBars sides={[{ ...a, color: ca }, { ...b, color: cb }]} max={max} rowH={40} />
      </div>
    </Frame>
  );
}

function SeasonCard({ s, usg }) {
  const max = Math.max(...s.leaders.map((l) => Math.abs(l.va)));
  return (
    <Frame right={s.scopeLabel + (usg ? " · USG-ADJ" : "")}>
      <div style={{ display: "flex", alignItems: "baseline", gap: 18, marginBottom: 18 }}>
        <span style={{ fontSize: 54, fontWeight: 900, letterSpacing: -1 }}>{s.season}</span>
        <span style={{ fontSize: 26, color: MUTED, letterSpacing: 3, textTransform: "uppercase" }}>Value Added leaders</span>
      </div>
      {s.leaders.map((l, i) => {
        const c = teamColor(l.team);
        return (
          <div key={i} style={{ display: "flex", alignItems: "center", height: 62, borderBottom: `1px solid ${RULE}` }}>
            <span style={{ width: 44, fontSize: 26, color: FAINT, fontWeight: 700 }}>{i + 1}</span>
            <span style={{ width: 400, fontSize: 30, fontWeight: 700 }}>{l.name}</span>
            <span style={{ width: 90, fontSize: 20, color: c, fontWeight: 700 }}>{l.team}</span>
            <div style={{ display: "flex", width: 340 }}>
              <div style={{ width: Math.max(4, Math.round((Math.abs(l.va) / max) * 320)), height: 22, background: c, display: "flex" }} />
            </div>
            <span style={{ fontSize: 28, fontWeight: 900, width: 200, textAlign: "right", justifyContent: "flex-end", display: "flex" }}>{sign(l.va)}</span>
          </div>
        );
      })}
    </Frame>
  );
}

function TitleCard() {
  return (
    <Frame>
      <div style={{ display: "flex", flexDirection: "column", justifyContent: "center", flex: 1 }}>
        <span style={{ fontFamily: "Playfair", fontWeight: 900, fontSize: 96, lineHeight: 1, letterSpacing: -2 }}>Value Added Tracker</span>
        <span style={{ fontSize: 32, color: MUTED, marginTop: 28, maxWidth: 1000, lineHeight: 1.3 }}>
          Every NBA box score since 1980-81, priced in points above what the league would have produced in the same minutes.
        </span>
      </div>
    </Frame>
  );
}

export async function GET(req) {
  const st = parseShareParams(new URL(req.url).searchParams);
  const [fonts, sum] = await Promise.all([loadFonts(), shareSummary(st).catch(() => null)]);
  const card = sum?.kind === "compare" ? <CompareCard a={sum.a} b={sum.b} usg={st.usg} />
    : sum?.kind === "player" ? <PlayerCard a={sum.a} usg={st.usg} />
    : sum?.kind === "career" ? <PlayerCard a={sum.a} career={sum.career} usg={st.usg} />
    : sum?.kind === "season" ? <SeasonCard s={sum.s} usg={st.usg} />
    : <TitleCard />;
  return new ImageResponse(card, {
    width: W,
    height: H,
    fonts,
    headers: {
      // Same data for the life of a deployment; the page's og:image URL
      // carries the build id, so a new build is a new URL.
      "Cache-Control": "public, max-age=86400, s-maxage=604800, stale-while-revalidate=2592000",
    },
  });
}
