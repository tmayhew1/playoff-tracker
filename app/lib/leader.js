// Which side of a game gets filled in: whoever's ahead, or won. A tie keeps
// the fill on whoever led last, so the color only moves on a lead change
// instead of blinking out every time the score's knotted. The last leader is
// remembered per game, and kept in localStorage so a reload mid-game still
// knows it. A game with no known last leader (first seen while tied) fills
// the home side; before tip both sides stay outlined.
const KEY = "lastLeader";
const lastLeader = new Map();
try {
  for (const [id, tri] of Object.entries(JSON.parse(localStorage.getItem(KEY) || "{}"))) lastLeader.set(id, tri);
} catch {}

function remember(gameId, tri) {
  if (lastLeader.get(gameId) === tri) return;
  lastLeader.set(gameId, tri);
  // Only the most recent games are worth keeping.
  while (lastLeader.size > 50) lastLeader.delete(lastLeader.keys().next().value);
  try { localStorage.setItem(KEY, JSON.stringify(Object.fromEntries(lastLeader))); } catch {}
}

export function gameLeader(g) {
  if (!g || g.gameStatus < 2) return null;
  const { home, away } = g;
  if (home.score !== away.score) {
    const tri = home.score > away.score ? home.tri : away.tri;
    if (g.gameId) remember(g.gameId, tri);
    return tri;
  }
  return (g.gameId && lastLeader.get(g.gameId)) || home.tri;
}
