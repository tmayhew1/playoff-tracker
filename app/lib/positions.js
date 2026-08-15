// Positions, and the drill-down the filter reads them through.
//
// Basketball-reference lists a position per player-season, which is the only
// place position enters this project — there is no roster file. Two things
// follow from that, and both live here so the API and the board agree:
//
//   * A season's label is a string BR wrote, not an enum. It is usually one of
//     the five ("PG"), sometimes a slash/hyphen pair for a player who split a
//     year ("SG-SF"), and in the early-80s files sometimes just the bucket
//     ("G"). normalize() takes the primary listing and leaves the rest.
//   * A CAREER has no single label at all. modalPosition() picks the one a
//     player logged the most minutes at, which is the only summary that stays
//     stable as later seasons land — see the note there.

// The three buckets, in the order a box score lists them, each opening into the
// positions inside it. C is a bucket with one leaf rather than a special case,
// so the drill-down below needs no branch for it.
export const POSITION_GROUPS = [
  { key: "G", leaves: ["PG", "SG"] },
  { key: "F", leaves: ["SF", "PF"] },
  { key: "C", leaves: ["C"] },
];

const BUCKET_OF = new Map([
  ["PG", "G"], ["SG", "G"], ["G", "G"],
  ["SF", "F"], ["PF", "F"], ["F", "F"],
  ["C", "C"],
]);

// Every value the filter can hold, so a query param can be validated against
// the same list the chips are built from.
export const POSITIONS = [...new Set([
  ...POSITION_GROUPS.map((g) => g.key),
  ...POSITION_GROUPS.flatMap((g) => g.leaves),
])];

// The bucket a position sits in; null for anything unrecognized.
export const bucketOf = (pos) => BUCKET_OF.get(pos) || null;

// Is this one of the three buckets rather than a specific position?
export const isBucket = (pos) => POSITION_GROUPS.some((g) => g.key === pos);

// BR's season label -> one position. A player who split a season is listed
// "SG-SF", primary listing first, so the first token is the position he was
// mostly playing — the same reading the minutes weighting below applies across
// seasons, one level down.
export function normalizePosition(raw) {
  if (!raw) return null;
  const first = String(raw).toUpperCase().split(/[-/,]/)[0].trim();
  return BUCKET_OF.has(first) ? first : null;
}

// A career's position: the one it spent the most MINUTES at.
//
// Minutes rather than seasons because the alternative is a tie-break between
// two five-season stretches decided by which happened to be longer, and rather
// than "most recent" because a career should not be relabelled by the two years
// a player finished out of position — the point of this filter is to find the
// guards, and Jordan's Wizards seasons do not make him one.
//
// Ties resolve by POSITIONS order rather than by insertion, so a career sitting
// exactly between two positions lands the same way on every bake instead of
// following whatever order the season files happened to be read in.
export function modalPosition(minutesByPos) {
  let best = null, bestMin = 0;
  for (const pos of POSITIONS) {
    const m = minutesByPos.get(pos) || 0;
    if (m > bestMin) { best = pos; bestMin = m; }
  }
  return best;
}

// Does a career's position satisfy the filter? A bucket matches everything
// inside it, so "G" keeps both guards; a specific position matches only itself.
//
// A career whose seasons carried no position at all matches nothing once a
// filter is on: it is unknown, not universal, and letting it through would
// quietly pad every bucket with the same rows.
export function matchesPosition(careerPos, filter) {
  if (!filter) return true;
  if (!careerPos) return false;
  return isBucket(filter) ? bucketOf(careerPos) === filter : careerPos === filter;
}

// The chips to offer given what is selected — the drill-down itself.
//
// One rule produces the whole ladder: walk the buckets in order, opening the
// one the selection sits in and leaving the others closed, then drop the chip
// that is already active. Nothing selected offers the three buckets; tapping G
// opens it to PG/SG/F/C; tapping PG leaves SG/F/C, since PG is now the active
// filter and the useful moves are its sibling or a different bucket.
export function positionChips(selected) {
  const sel = selected || "";
  const open = sel ? bucketOf(sel) : null;
  const chips = [];
  for (const g of POSITION_GROUPS) {
    if (open === g.key) chips.push(...g.leaves);
    else chips.push(g.key);
  }
  return chips.filter((c) => c !== sel);
}

// One step back out of the drill-down: a position widens to its bucket, a
// bucket clears. Lets the active chip undo exactly the tap that set it,
// instead of dropping the reader back to the unfiltered board from two levels
// in.
export function positionParent(pos) {
  if (!pos || isBucket(pos)) return "";
  return bucketOf(pos) || "";
}
