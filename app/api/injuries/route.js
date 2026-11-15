import { parseEspnInjuryReport } from "../../lib/injuries";

export const runtime = "nodejs";
export const maxDuration = 10;
// The injury report moves through the day and again in the hours before a
// tip; ten minutes keeps a pregame card current without a request a tap.
export const revalidate = 600;

// The league's current injury report, for the Live tab's pregame card: who
// is ruled out of tonight's games and who is listed but expected to play.
// ESPN's injuries feed (lib/injuries.js parseEspnInjuryReport), each player
// on his NBA tricode:
//   { asOf, players: [{ name, team, out, status, injury, note, date }] }
// When the feed can't be read `players` is null, and the card says the
// report is unavailable rather than showing everyone as playing.

const ESPN = "https://site.api.espn.com/apis/site/v2/sports/basketball/nba/injuries";
const ESPN_TO_NBA = { GS: "GSW", NO: "NOP", NY: "NYK", SA: "SAS", UTAH: "UTA", WSH: "WAS" };
// The feed's team blocks are named in full; an entry without its athlete's
// team abbreviation is placed by that name.
const BY_NAME = {
  "Atlanta Hawks": "ATL", "Boston Celtics": "BOS", "Brooklyn Nets": "BKN", "Charlotte Hornets": "CHA", "Chicago Bulls": "CHI",
  "Cleveland Cavaliers": "CLE", "Dallas Mavericks": "DAL", "Denver Nuggets": "DEN", "Detroit Pistons": "DET", "Golden State Warriors": "GSW",
  "Houston Rockets": "HOU", "Indiana Pacers": "IND", "LA Clippers": "LAC", "Los Angeles Clippers": "LAC", "Los Angeles Lakers": "LAL",
  "Memphis Grizzlies": "MEM", "Miami Heat": "MIA", "Milwaukee Bucks": "MIL", "Minnesota Timberwolves": "MIN", "New Orleans Pelicans": "NOP",
  "New York Knicks": "NYK", "Oklahoma City Thunder": "OKC", "Orlando Magic": "ORL", "Philadelphia 76ers": "PHI", "Phoenix Suns": "PHX",
  "Portland Trail Blazers": "POR", "Sacramento Kings": "SAC", "San Antonio Spurs": "SAS", "Toronto Raptors": "TOR", "Utah Jazz": "UTA",
  "Washington Wizards": "WAS",
};

export async function GET() {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), 5000);
  try {
    const res = await fetch(ESPN, { signal: ctrl.signal, next: { revalidate } });
    if (!res.ok) throw new Error(`ESPN ${res.status}`);
    const players = parseEspnInjuryReport(await res.json()).map(({ teamName, team, ...p }) => ({
      ...p, team: (team && (ESPN_TO_NBA[team] || team)) || BY_NAME[teamName] || null,
    }));
    return Response.json({ asOf: new Date().toISOString(), players }, {
      headers: { "Cache-Control": "public, s-maxage=600, stale-while-revalidate=1800" },
    });
  } catch (e) {
    return Response.json({ asOf: new Date().toISOString(), players: null, error: e.message || "Injury report unavailable" }, {
      headers: { "Cache-Control": "no-store" },
    });
  }
}
