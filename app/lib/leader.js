// Which side of a game gets filled in: whoever's ahead, or won. A tie keeps
// the fill on whoever led last, so the color only moves on a lead change
// instead of blinking out every time the score's knotted. The last leader is
// remembered per game for the life of the page; a game first seen while tied
// (or before tip) has none, and both sides stay outlined.
const lastLeader = new Map();

export function gameLeader(g) {
  if (!g || g.gameStatus < 2) return null;
  const { home, away } = g;
  if (home.score !== away.score) {
    const tri = home.score > away.score ? home.tri : away.tri;
    if (g.gameId) lastLeader.set(g.gameId, tri);
    return tri;
  }
  return (g.gameId && lastLeader.get(g.gameId)) || null;
}
