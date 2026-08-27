"use client";

import { useState, useEffect } from "react";
import { LGA, USG_FTA_W, usageModelFor } from "../scoring";
import { timeAgo } from "../lib/format";


// Informational page: data freshness, how the pipeline loads data, and the
// Value Added formula (mirrored from app/scoring.js).
export function InfoView() {
  const [status, setStatus] = useState(null);
  useEffect(() => {
    let cancelled = false;
    fetch("/api/data-status")
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => { if (!cancelled && d) setStatus(d); })
      .catch(() => {});
    return () => { cancelled = true; };
  }, []);

  const refreshed = status?.lastRefresh ? new Date(status.lastRefresh) : null;

  // Constants are read from the current season's baselines rather than typed
  // in, so a rebake can never leave the printed formula behind the code.
  const fmt = (v, d = 3) => (v ?? 0).toFixed(d);
  const SCORING = [
    { label: "Scoring volume", f: `( PTS/min − ${fmt(LGA.laPTSperM)} ) × min` },
    { label: "3-pt shooting", f: `3 × ( 3PM/3PA − ${fmt(LGA.la3P)} ) × 3PA` },
    { label: "2-pt shooting", f: `2 × ( 2PM/2PA − ${fmt(LGA.la2P)} ) × 2PA` },
    { label: "Free throws", f: `( FTM/FTA − ${fmt(LGA.laFT)} ) × FTA` },
  ];
  const PLAYDEF = [
    { label: "Assists", f: `( AST/min − ${fmt(LGA.laASTperM)} ) × min × ${fmt(LGA.laPTSperMake)} × (1 − ${fmt(LGA.laFG)})` },
    { label: "Steals", f: `( STL/min − ${fmt(LGA.laSTLperM)} ) × min × ${fmt(LGA.laPTSperPoss)}` },
    { label: "Blocks", f: `( BLK/min − ${fmt(LGA.laBLKperM)} ) × min × ${fmt(LGA.laPTSperPoss)} × ${fmt(LGA.laDRBrate)}` },
    { label: "Turnovers", f: `−( TOV/min − ${fmt(LGA.laTOVperM)} ) × min × ${fmt(LGA.laPTSperPoss)}` },
  ];
  // The USG-ADJ line for the current season, read from the fitted model rather
  // than typed in, for the same reason the constants above are.
  const USG = usageModelFor("2025-26");
  const REB = [
    { label: "Def. rebounds", f: `γ × ( DRB/min − ${fmt(LGA.laDRBperM)} ) × min × ${fmt(LGA.laPTSperPoss)} × ${fmt(LGA.laORBrate)}` },
    { label: "Off. rebounds", f: `γ × ( ORB/min − ${fmt(LGA.laORBperM)} ) × min × ${fmt(LGA.laPTSperPoss)} × ${fmt(LGA.laDRBrate)}` },
  ];

  const Group = ({ title, items }) => (
    <div className="mb-3">
      <div className="text-[9px] uppercase tracking-widest text-stone-400 mb-1">{title}</div>
      {items.map((it) => (
        <div key={it.label} className="flex flex-col sm:flex-row sm:items-baseline sm:justify-between gap-0.5 py-1 border-b border-stone-100">
          <span className="text-xs font-semibold text-stone-700">{it.label}</span>
          <span className="text-[11px] tabular-nums text-stone-500" style={{ fontFamily: "Georgia, 'Times New Roman', serif" }}>{it.f}</span>
        </div>
      ))}
    </div>
  );

  // The story of the app, told in the order it was built.
  const Step = ({ n, title, children }) => (
    <section className="p-3 bg-white border border-stone-300 text-sm text-stone-700 leading-relaxed">
      <h2 className="text-xs font-bold uppercase tracking-[0.2em] text-stone-900 mb-2">
        <span className="text-stone-400 tabular-nums mr-1.5">{n}</span>{title}
      </h2>
      {children}
    </section>
  );

  return (
    <div className="space-y-5">
      <section className="p-3 bg-white border border-stone-300">
        <h2 className="text-xs font-bold uppercase tracking-[0.2em] text-stone-900 mb-2">Data status</h2>
        {status ? (
          <div className="space-y-1 text-sm text-stone-700">
            <div>
              Last refreshed: <span className="font-semibold text-stone-900">{refreshed ? refreshed.toLocaleString() : "—"}</span>
              {refreshed && <span className="text-stone-400"> ({timeAgo(status.lastRefresh)})</span>}
            </div>
            <div className="text-xs text-stone-500">
              {status.seasonsBaked} season{status.seasonsBaked === 1 ? "" : "s"} stored
              {status.earliestSeason && ` (${status.earliestSeason} – ${status.latestSeason})`}
              {status.latestRefreshedSeason && `, most recent bake: ${status.latestRefreshedSeason}.`}
            </div>
          </div>
        ) : (
          <div className="text-[10px] text-stone-400 italic">Checking…</div>
        )}
      </section>

      <Step n="1" title="The draft">
        <p className="mb-2">This app began as a scorekeeper. Before the 2025-26 playoffs, <span className="font-semibold">Trey and Spencer drafted all 16 playoff teams</span>, eight apiece. Every series win banks its round&apos;s base points — <span className="tabular-nums font-semibold">1</span> for the first round, <span className="tabular-nums font-semibold">2</span> for the conference semis, <span className="tabular-nums font-semibold">4</span> for the conference finals, <span className="tabular-nums font-semibold">8</span> for the Finals — plus, on an upset, the seed difference as a bonus.</p>
        <p>While a playoff run is live, the bracket and scoreboard follow the NBA feed game by game. The season tabs keep each year&apos;s final scorecard, rosters, bracket, and every box score.</p>
      </Step>

      <Step n="2" title="Value Added (VA)">
        <p className="mb-3">Team points settle the draft; <span className="font-semibold">Value Added</span> settles the player arguments. VA is the points a player creates above — or below — the typical NBA player, given the same workload. Every skill follows one shape:</p>
        <div className="p-2 mb-3 bg-stone-50 border border-stone-200 rounded text-center text-xs text-stone-700" style={{ fontFamily: "Georgia, 'Times New Roman', serif" }}>
          ( player rate − <span className="text-amber-700 font-semibold">league rate</span> ) × opportunity × point value
        </div>
        <Group title="Scoring" items={SCORING} />
        <Group title="Playmaking &amp; Defense" items={PLAYDEF} />
        <Group title="Rebounding" items={REB} />
        <p className="text-[10px] text-stone-500 mt-1 mb-2 leading-relaxed">
          <span className="font-semibold">γ</span> is the rebound credit. A rebound is the one box-score event that&apos;s
          guaranteed to be won by <span className="italic">someone</span> — every miss produces exactly one, and one of
          the ten players on the floor gets it — so &ldquo;would his team have gotten it anyway?&rdquo; has a real answer.
          If a player claims a share <span className="font-semibold">q</span> of the boards available at his end
          (his REB/min over the league&apos;s <span className="tabular-nums">{fmt(LGA.laREBoppPerM)}</span> chances per
          minute), removing him raises his team&apos;s chance of losing the possession by
          <span className="font-semibold"> 1 ⁄ (1 − q)</span> — so that is what each of his boards is worth.
          A league-average rebounder lands at <span className="tabular-nums">1.17</span> on the defensive glass and
          <span className="tabular-nums"> 1.05</span> on the offensive; a player who covers a third of his end reaches
          <span className="tabular-nums"> 1.5</span>. It reads only his own line, never his teammates&apos;.
        </p>
        {USG && (
          <p className="text-[10px] text-stone-500 mt-2 mb-2 leading-relaxed">
            <span className="font-semibold">USG-ADJ</span> is a second reading of that first line.
            Scoring volume normally charges every player the same league rate for his minutes,
            which is the point — VA pays for absorbing volume — but it never asks whether the
            volume was worth having. Flip <span className="font-semibold">Scoring baseline</span>
            {" "}(above the boards, on Explore and any season tab) and that one term is measured
            instead against a line fit to <span className="italic">every</span> player-season in
            the league that year:
            {" "}<span className="tabular-nums">PTS/min ≈ {fmt(USG.a)} + {fmt(USG.b)} × (poss. used/min)</span>,
            {" "}where possessions used = FGA + <span className="tabular-nums">{USG_FTA_W}</span> × FTA
            (2025-26&apos;s line; it explains <span className="tabular-nums">{Math.round(USG.r2 * 100)}%</span>
            {" "}of the spread in scoring rate). The baseline becomes what the league actually
            scores on the possessions <span className="italic">he</span> used, so volume only pays
            above the going rate for that workload — and a player who uses nothing is charged
            almost nothing to clear. The other nine categories are untouched, and at the median
            minute of usage the fitted line sits within a few thousandths of the flat baseline, so
            it redistributes value rather than re-levelling it. Legacy and College keep the standard
            baseline.
          </p>
        )}
        <p className="text-[10px] text-stone-400 mt-2 leading-relaxed">VA is the sum of all ten. Per-minute baselines are the league&apos;s <span className="font-semibold">minutes-weighted median</span> rates (half of all NBA minutes are played above them, half below) so a few high-usage stars can&apos;t skew the bar; shooting percentages and the conversion constants (points per possession, points per made shot, DRB%/ORB%) are league aggregates. Baselines are season-accurate — the constants above are 2025-26&apos;s — so older eras are measured against their own league, not today&apos;s. Playoff runs use their season&apos;s regular-season baselines, keeping every era on level ground.</p>
      </Step>

      <Step n="3" title="The data pipeline">
        <p className="mb-2">To take VA beyond one spring, an <span className="font-semibold">R pipeline</span> scrapes basketball-reference and stores every season from <span className="font-semibold">1979-80</span> onward as JSON in the repo: playoff and regular-season totals, per-game playoff logs, and each season&apos;s league baselines.</p>
        <p>A scheduled job runs every morning — re-baking the current season, filling any gaps, and recomputing derived numbers so nothing can drift from the raw data. Everything the app shows is computed from this one store, reproducible across seasons.</p>
      </Step>

      <Step n="4" title="Explore">
        <p className="mb-2"><span className="font-semibold">By Season</span> ranks every player in a season&apos;s playoffs, regular season, or both combined. The default order blends total VA with VA per game; tap <span className="font-semibold">TOT VA</span> or <span className="font-semibold">VA/G</span> to sort by one axis, a team badge to filter to a roster, and <span className="font-semibold">G</span> (header first, then a player&apos;s G) to keep only comparable-volume players.</p>
        <p><span className="font-semibold">By Player</span> searches everyone ever indexed and lays a career out season by season. Tap a season for its per-category breakdown, and a category for league context — rank, percentile, and where the season sits in the all-time distribution.</p>
      </Step>

      <Step n="5" title="Compare &amp; closest comps">
        <p className="mb-2"><span className="font-semibold">Compare</span> pits any two player-seasons head-to-head — absolute values or all-time percentiles, category by category, with raw-stat drill-ins and a career-year overlay chart.</p>
        <p>The picker also suggests <span className="font-semibold">closest comps</span>, by decade, among players in a similar minutes role. <span className="font-semibold">Box Score VA</span> demands both a matching overall per-game VA level and a matching shape across the ten-category profile. (A second lens, Shooting, arrived with the shot zones below.)</p>
      </Step>

      <Step n="6" title="College">
        <p>The same framework pointed at men&apos;s Division I: top college players ranked by VA against <span className="font-semibold">college</span> baselines, with the same per-category breakdowns and sortable board.</p>
      </Step>

      <Step n="7" title="D Rating &amp; VA+">
        <p className="mb-2">Steals and blocks miss most of defense, so each player-season gets a <span className="font-semibold">DRtg</span> — points allowed per 100 possessions. It&apos;s a <span className="font-semibold">Bayesian blend</span>: basketball-reference&apos;s box-score estimate serves as the prior (worth ≈1,500 possessions of evidence), updated by the points opponents <span className="font-semibold">actually scored with him on the floor</span> (play-by-play data, 2000-01 onward). The more real possessions a player logs, the more the data outweighs the estimate — a full-time starter is ~75% play-by-play, a 300-minute season stays mostly prior.</p>
        <p className="mb-2">The estimate is <span className="font-semibold">calibrated</span> before it&apos;s used. Measured against the play-by-play seasons, it gets team defense right but separates <em>teammates</em> about five times as hard as real on-court play does — largely by re-reading steals and blocks, which VA already counts on their own. Since the older seasons have no play-by-play to correct it, that inflation used to land entirely on them, and the same defender scored ~1.5× higher pre-2000. Halving the estimate&apos;s within-team spread puts both eras on one scale.</p>
        <p className="mb-2">Defensive value then comes from two terms: <span className="font-semibold">IND</span>, the player&apos;s edge over his own team&apos;s defense, and <span className="font-semibold">TM+</span>, a share of the team&apos;s edge over the league — earned by steal-and-block rate when the team is good, shrinking with activity when it&apos;s bad.</p>
        <p className="mb-2">Both of those lean on a team line drawn from the team&apos;s <em>whole</em> season, and the player was only there for part of it. What the rating is really asking is how the defense held up over the possessions <em>he</em> played, so the team line is <span className="font-semibold">weighted by how much of the season he was present for</span>, the rest taken at the league line. Play every night and it&apos;s your team&apos;s line, unchanged. Play eleven games for a team that finished seven points worse than the league and you carry under half of that gap — eleven games is not enough to say a full season&apos;s collapse describes your minutes. The weight comes from the spread of team defense game to game (±11.5 per 100) against the spread between teams over a season (±3).</p>
        <p><span className="font-semibold">VA+ = VA + defensive value.</span> The VA view on either Explore board — By Season and By Player both carry the switch — keeps the pure box-score stat; toggle VA+ to re-score everything with the defensive layer. The <span className="font-semibold">D Rating</span> tab ranks every player-season by it, sortable by any column.</p>
      </Step>

      <Step n="8" title="Shot Zones &amp; Shooting comps">
        <p className="mb-2">2-point shooting, split by distance: <span className="font-semibold">0-3, 3-10, 10-16, and 16 ft to the arc</span> (shot-location data exists from 1996-97 on). Each zone is valued with the same VA shape — 2 × (zone FG% − the league&apos;s FG% at that distance) × attempts — so a rim finisher and a mid-range surgeon get credit for different skills instead of one blended 2P%.</p>
        <p>Zone rows sit under the 2-Pointers card in any comparison (per-game, like the rest of the panel), the <span className="font-semibold">Shot Zones</span> tab ranks seasons by zone value, and the <span className="font-semibold">Shooting</span> comp lens matches whole shooting profiles — the four zones plus 3-point and free-throw value — among players who take a similar share of their shots from three.</p>
      </Step>

      <Step n="9" title="Legacy">
        <p className="mb-2">VA is context-free on purpose — the same line scores the same whoever it came against. That&apos;s right for a season and wrong for an all-time board, where a Finals game and Game 82 of a lottery year are plainly not the same event. So the <span className="font-semibold">Legacy</span> tab prices basketball by <span className="font-semibold">championship leverage</span>: how much winning moves the probability of a title, under a neutral coin where every game is a 50/50 and every future series is a 50/50.</p>
        <p className="mb-2">The unit is the <span className="font-semibold">series</span>, not the game. Winning a series moves a title by half for each round still to come, and that stake is spread across however many games the series actually took — so a sweep concentrates it into four games and a seven-game grind dilutes it across seven. Pricing the individual game state instead, which is what this used to do, charged a team twice for winning quickly: fewer games, and cheaper ones, because a team that never trails never reaches the expensive scorelines. Each season is anchored to its <em>own</em> opening series, so a shallower bracket doesn&apos;t hand an older era extra credit, and the regular season is priced the same way — a playoff berth, spread over the schedule.</p>
        <p className="mb-2">Careers get <span className="font-semibold">two numbers, not one</span>. <span className="font-semibold">Legacy</span> folds a career&apos;s seasons by how good each one was rather than by where it ranks: a season worth half your best carries about 81% of its weight, one worth a tenth carries half. So extra years always add, in proportion to what they were worth, and hanging on for a few replacement-level seasons is neither rewarded nor punished. <span className="font-semibold">Peak/G</span> is the same leverage weighting as a rate over the best seven seasons. They disagree, and the disagreement is the point: tap either column to sort by it. The weighting behind that fold isn&apos;t a taste either, and it isn&apos;t keyed to rank — a rank rule would say your eighth-best season counts a fixed fraction whether it was nearly your best or nearly worthless. It comes from one stated rule instead: a season worth a tenth of your best should still carry half the weight.</p>
        <p>Tap a player to open the fold itself — every season in value order, with the weight it earned and the weighted value that sums to the total. The bar under each season splits it: dark is the playoff run, light the regular season. A handful of games usually outweighs a whole winter, which is leverage doing its job.</p>
      </Step>

      <Step n="10" title="2025-26, in the books">
        <p>The playoffs the app was built for ended with the <span className="font-semibold">Knicks over the Spurs</span> — and <span className="font-semibold">Spencer over Trey, 36-9</span>. That season now lives in its own tab like any other finished year, and the app keeps growing between drafts.</p>
      </Step>

      <section className="p-3 bg-white border border-stone-300 text-[10px] text-stone-400 leading-relaxed">
        <h2 className="text-xs font-bold uppercase tracking-[0.2em] text-stone-900 mb-2">Fine print</h2>
        <p>Coverage follows the sources: box-score VA reaches 1979-80; shot zones start 1996-97; on-court defensive data starts 2000-01 (a handful of seasons in between lack it upstream and fall back to the estimate — they fill in automatically if the source ever adds them). Historical data comes from basketball-reference.com, live games from the NBA feed, on-court defense from pbpstats.com, college stats from sports-reference.com. Players are matched across sources by ID where possible, by normalized name otherwise.</p>
      </section>
    </div>
  );
}
