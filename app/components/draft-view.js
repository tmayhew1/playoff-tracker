"use client";

import { useEffect, useMemo, useState } from "react";
import { fetchBakedJson } from "../lib/fetch-cache";
import { bracketOdds, completeDraft, recommend, simulate } from "../lib/draft-model";
import { ownerBadge, ownerColor, ownerDot, teamColor } from "../lib/format";

// The draft assistant. For a draft season: every team's chance to win each
// round, its expected points under the draft's scoring, and — for whichever
// owner you're advising — the pick that most raises their chance of winning
// the draft. Owners can be reassigned in place (tap a team's owner chip), so
// a past draft can be replayed as a what-if, or cleared and run as a mock.
//
// The model and its track record: lib/draft-model.js, scripts/fit-draft-model.mjs.

const OWNERS = ["Spencer", "Trey"];
const other = (o) => (o === "Spencer" ? "Trey" : "Spencer");
const pct = (p) => (p == null ? "–" : p >= 0.995 ? ">99%" : p < 0.005 ? "<1%" : `${Math.round(p * 100)}%`);

export function DraftView() {
  const [seasons, setSeasons] = useState([]);
  const [season, setSeason] = useState(null);
  const [data, setData] = useState(null);
  const [error, setError] = useState(null);
  const [owners, setOwners] = useState({});
  const [me, setMe] = useState("Trey");
  const [openTeam, setOpenTeam] = useState(null);

  useEffect(() => {
    let cancelled = false;
    setError(null);
    fetchBakedJson(`/api/draft${season ? `?season=${season}` : ""}`)
      .then((d) => {
        if (cancelled) return;
        setData(d);
        setSeasons(d.seasons);
        if (!season) setSeason(d.season);
        setOwners(Object.fromEntries(Object.entries(d.teams).map(([t, x]) => [t, x.owner])));
        setOpenTeam(null);
      })
      .catch((e) => !cancelled && setError(e.message || "Load failed"));
    return () => { cancelled = true; };
  }, [season]);

  const teams = data?.teams || null;
  const model = data?.model || null;
  const odds = useMemo(() => (model && teams ? bracketOdds(model, teams) : null), [model, teams]);
  const free = teams ? Object.keys(teams).filter((t) => !owners[t]) : [];
  // Mid-draft, the cards project the finished draft: the owner with fewer
  // teams picks next (the other owner on a tie, matching the advice), then
  // alternating by expected points.
  const sim = useMemo(() => {
    if (!model || !teams || !odds) return null;
    let o = owners;
    if (free.length) {
      const n = (x) => Object.values(owners).filter((v) => v === x).length;
      const first = n(me) < n(other(me)) ? me : other(me);
      o = completeDraft(odds, owners, first, other(first));
    }
    return simulate(model, teams, o, { names: OWNERS });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [model, teams, odds, owners, me, free.length]);
  const advice = useMemo(
    () => (model && teams && free.length ? recommend(model, teams, owners, me, other(me))?.sort((a, b) => b.winProb - a.winProb) : null),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [model, teams, owners, me, free.length],
  );

  if (error) return <div className="text-[10px] text-red-600 py-6 text-center">Couldn’t load the draft — {error}</div>;
  if (!data || !odds) return <div className="text-[10px] text-stone-500 italic py-6 text-center">Loading draft…</div>;

  const asDrafted = Object.entries(teams).every(([t, x]) => owners[t] === x.owner);
  const rows = Object.keys(teams).sort((a, b) => odds[b].ep - odds[a].ep);
  const cycle = (t) => setOwners((o) => {
    const cur = o[t];
    const next = cur === "Spencer" ? "Trey" : cur === "Trey" ? null : "Spencer";
    return { ...o, [t]: next };
  });
  const sumBy = (o, f) => Object.keys(teams).filter((t) => owners[t] === o).reduce((a, t) => a + f(t), 0);
  const finished = Object.values(teams).some((t) => t.actual != null);

  return (
    <div>
      <div className="mb-3 p-3 bg-white border border-stone-300 flex flex-wrap items-end gap-3">
        <label className="flex-1 min-w-[8rem]">
          <span className="text-[10px] uppercase tracking-[0.3em] text-stone-500 block mb-1">Draft</span>
          <select value={season || ""} onChange={(e) => setSeason(e.target.value)}
            className="w-full text-sm font-bold text-stone-900 bg-white border border-stone-300 px-2 py-1.5">
            {seasons.map((s) => <option key={s} value={s}>{s}</option>)}
          </select>
        </label>
        <div>
          <span className="text-[10px] uppercase tracking-[0.3em] text-stone-500 block mb-1">Advising</span>
          <div className="flex">
            {OWNERS.map((o) => (
              <button key={o} onClick={() => setMe(o)}
                className={`px-2.5 py-1.5 text-[10px] font-bold uppercase tracking-widest border ${me === o ? `${ownerBadge(o)} border-current` : "bg-white text-stone-400 border-stone-300"}`}>
                {o}
              </button>
            ))}
          </div>
        </div>
      </div>

      <div className="flex gap-2 mb-2">
        {OWNERS.map((o) => (
          <div key={o} className={`flex-1 p-3 border-2 ${o === "Spencer" ? "border-amber-600" : "border-teal-600"} bg-white`}>
            <div className="flex items-center gap-1.5 mb-1">
              <span className={`w-2 h-2 rounded-full ${ownerDot(o)}`} />
              <span className="text-[10px] font-bold uppercase tracking-widest text-stone-700">{o}</span>
            </div>
            <div className={`text-3xl font-black tabular-nums ${ownerColor(o)}`}>{pct(sim?.winProb[o])}</div>
            <div className="text-[10px] text-stone-500 uppercase tracking-wider">{free.length ? "projected to win" : "to win the draft"}</div>
            <div className="mt-2 pt-2 border-t border-stone-200 text-[11px] text-stone-600 tabular-nums">
              {sumBy(o, (t) => odds[t].ep).toFixed(1)} expected pts
              {finished && asDrafted && <span className="text-stone-900 font-bold"> · {sumBy(o, (t) => teams[t].actual)} actual</span>}
            </div>
          </div>
        ))}
      </div>
      <div className="flex items-center justify-between mb-4 text-[10px] text-stone-500">
        <span>{sim?.tieProb > 0.005 ? `Tie ${pct(sim.tieProb)} · ` : ""}{free.length ? `${free.length} team${free.length === 1 ? "" : "s"} undrafted` : "All 16 teams drafted"}</span>
        <span className="flex gap-2">
          {!asDrafted && <button onClick={() => setOwners(Object.fromEntries(Object.entries(teams).map(([t, x]) => [t, x.owner])))} className="underline">Reset to the real draft</button>}
          {Object.values(owners).some(Boolean) && <button onClick={() => setOwners({})} className="underline">Clear for a mock draft</button>}
        </span>
      </div>

      {advice?.length > 0 && (
        <div className="mb-4 p-3 bg-white border-2 border-stone-900">
          <div className="text-[10px] font-bold uppercase tracking-[0.25em] text-stone-900 mb-2">Best picks for {me}</div>
          {advice.slice(0, 5).map((a, i) => (
            <button key={a.tri} onClick={() => setOwners((o) => ({ ...o, [a.tri]: me }))}
              className="w-full flex items-center gap-2 py-1.5 border-b border-stone-100 last:border-0 text-left">
              <span className="w-4 text-[11px] text-stone-400 tabular-nums">{i + 1}</span>
              <span className="w-10 text-[11px] font-bold" style={{ color: teamColor(a.tri) }}>{a.tri}</span>
              <span className="flex-1 text-[11px] text-stone-600">{teams[a.tri].conf}{teams[a.tri].seed} · {teams[a.tri].name}</span>
              <span className="text-[11px] tabular-nums text-stone-500 w-14 text-right">{a.ep.toFixed(1)} pts</span>
              <span className={`text-[12px] font-bold tabular-nums w-12 text-right ${ownerColor(me)}`}>{pct(a.winProb)}</span>
            </button>
          ))}
          <div className="text-[9px] text-stone-400 italic mt-2 leading-snug">
            Win % assumes the rest of the draft alternates, {other(me)} next, each side taking the most expected points left. Tap a team to draft it for {me}.
          </div>
        </div>
      )}

      <div className="bg-white border border-stone-300">
        <div className="grid grid-cols-[2.4rem_1fr_3rem_3rem_3.2rem_4.2rem] gap-x-1 px-2 py-1.5 text-[9px] uppercase tracking-wider text-stone-400 border-b border-stone-200">
          <span>Seed</span><span>Team</span><span className="text-right">Title</span>
          <span className="text-right">Exp</span><span className="text-right">{finished ? "Actual" : ""}</span><span className="text-right">Owner</span>
        </div>
        {rows.map((t) => {
          const x = teams[t];
          const open = openTeam === t;
          return (
            <div key={t} className="border-b border-stone-100 last:border-0">
              <div className="grid grid-cols-[2.4rem_1fr_3rem_3rem_3.2rem_4.2rem] gap-x-1 items-center px-2 py-1.5">
                <span className="text-[10px] text-stone-500 tabular-nums">{x.conf}{x.seed}</span>
                <button onClick={() => setOpenTeam(open ? null : t)} className="text-left truncate">
                  <span className="text-[12px] font-bold" style={{ color: teamColor(t) }}>{t}</span>
                  <span className="text-[10px] text-stone-400 ml-1">{open ? "▾" : "▸"} {x.strength.toFixed(1)}</span>
                </button>
                <span className="text-[11px] tabular-nums text-right text-stone-600">{pct(odds[t].win.r4)}</span>
                <span className="text-[12px] tabular-nums text-right font-bold text-stone-900">{odds[t].ep.toFixed(1)}</span>
                <span className="text-[12px] tabular-nums text-right text-stone-500">{x.actual ?? ""}</span>
                <span className="text-right">
                  <button onClick={() => cycle(t)} aria-label={`Change ${t}'s owner`}
                    className={`text-[9px] font-bold uppercase tracking-wider px-1.5 py-0.5 ${owners[t] ? ownerBadge(owners[t]) : "border border-dashed border-stone-300 text-stone-400"}`}>
                    {owners[t] || "open"}
                  </button>
                </span>
              </div>
              {open && (
                <div className="px-3 pb-2 text-[10px] text-stone-600">
                  <div className="flex gap-3 tabular-nums mb-1">
                    {["r1", "r2", "r3", "r4"].map((rk, i) => (
                      <span key={rk}>{["R1", "Semis", "Conf F", "Title"][i]} <b className="text-stone-900">{pct(odds[t].win[rk])}</b></span>
                    ))}
                  </div>
                  <div className="text-stone-500">
                    Strength {x.strength.toFixed(2)} VA/G from its top players:{" "}
                    {x.top.map((p) => `${p.name} ${p.vaPerG >= 0 ? "+" : ""}${p.vaPerG.toFixed(1)}/G`).join(" · ")}
                  </div>
                </div>
              )}
            </div>
          );
        })}
      </div>
      <div className="text-[9px] text-stone-400 mt-1 mb-4">
        Beside each team: its strength (top {model.n} players’ regular-season VA per game) · Title: chance to win it all · Exp: expected draft points · tap a team for its round-by-round odds, its owner chip to reassign it
      </div>

      <ModelNote model={model} rosterSource={data.rosterSource} />
    </div>
  );
}

function ModelNote({ model, rosterSource }) {
  const f = model.fit;
  const m = f.heldOut.model, home = f.heldOut.homeCourtOnly;
  return (
    <div className="p-3 bg-stone-50 border border-stone-200 text-[10px] text-stone-600 leading-relaxed">
      <div className="font-bold uppercase tracking-widest text-stone-500 mb-1">How it works</div>
      <p>
        Each series is a coin weighted by two things: home court (the better seed), and the gap in team strength — the
        top {model.n} players’ regular-season Value Added per game. Expected points and win chances follow from playing
        the bracket out under the draft’s scoring: round points plus the seed gap on an upset.
      </p>
      <p className="mt-1.5">
        Tested on {f.series} series ({f.seasons.replace("..", "–")}), predicting each season from the others: it calls{" "}
        {Math.round(m.accuracy * 100)}% of series, the same as home court alone ({Math.round(home.accuracy * 100)}%), but
        its probabilities are sharper (log loss {m.logLoss.toFixed(3)} vs {home.logLoss.toFixed(3)}; a coin flip is 0.693).
        Seeding already carries most of what’s knowable; Value Added adds a real but modest edge — and upsets are
        common enough that a clearly better roster still loses often.
      </p>
      <p className="mt-1.5 text-stone-400">
        {rosterSource === "playoffs"
          ? "Rosters are the players who appeared in these playoffs, so anyone ruled out beforehand is already excluded."
          : "Rosters are each player’s final regular-season team; injuries aren’t accounted for."}
      </p>
    </div>
  );
}
