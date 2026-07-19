"use client";

import { useState } from "react";
import { HISTORY } from "./historical";
import { CollegeView } from "./components/college-view";
import { DRatingView } from "./components/drating-view";
import { ExploreView } from "./components/explore";
import { HistoryView } from "./components/history";
import { InfoView } from "./components/info-view";
import { ShotZonesView } from "./components/shot-zones-view";


export default function PlayoffTracker() {
  const [tab, setTab] = useState("explore");
  const seasons = Object.keys(HISTORY);

  return (
    <div className="min-h-screen bg-stone-100" style={{ fontFamily: "Inter, system-ui, sans-serif" }}>
      <div className="max-w-2xl mx-auto px-4 py-6">
        <header className="mb-4 text-center">
          {/* "Trey's" rides the eyebrow in the serif display face — bigger and
              styled apart from the small-caps tag; the title drops a step so
              the two lines read more evenly. Both lines centered as a unit. */}
          <div className="flex items-baseline justify-center gap-1.5 mb-1">
            <span className="text-xl font-bold italic text-stone-800 leading-none" style={{ fontFamily: "'Playfair Display', Georgia, serif" }}>Trey&rsquo;s</span>
            <span className="text-xs uppercase tracking-[0.3em] text-stone-500">NBA Box Score</span>
          </div>
          <h1 className="text-2xl font-black text-stone-900 leading-none tracking-tight" style={{ fontFamily: "'Playfair Display', Georgia, serif" }}>Value Added Tracker</h1>
        </header>

        <div className="flex border-b-2 border-stone-900 mb-5 overflow-x-auto no-scrollbar">
          <button
            onClick={() => setTab("explore")}
            className={`px-3 py-2 text-[11px] font-bold uppercase tracking-widest whitespace-nowrap ${tab === "explore" ? "bg-stone-900 text-white" : "text-stone-500"}`}
          >
            Explore
          </button>
          {seasons.map((s) => (
            <button
              key={s}
              onClick={() => setTab(s)}
              className={`px-3 py-2 text-[11px] font-bold uppercase tracking-widest whitespace-nowrap ${tab === s ? "bg-stone-900 text-white" : "text-stone-500"}`}
            >
              {s}
            </button>
          ))}
          <button
            onClick={() => setTab("college")}
            className={`px-3 py-2 text-[11px] font-bold uppercase tracking-widest whitespace-nowrap ${tab === "college" ? "bg-stone-900 text-white" : "text-stone-500"}`}
          >
            College
          </button>
          <button
            onClick={() => setTab("drating")}
            className={`px-3 py-2 text-[11px] font-bold uppercase tracking-widest whitespace-nowrap ${tab === "drating" ? "bg-stone-900 text-white" : "text-stone-500"}`}
          >
            D Rating
          </button>
          <button
            onClick={() => setTab("shotzones")}
            className={`px-3 py-2 text-[11px] font-bold uppercase tracking-widest whitespace-nowrap ${tab === "shotzones" ? "bg-stone-900 text-white" : "text-stone-500"}`}
          >
            Shot Zones
          </button>
          <button
            onClick={() => setTab("info")}
            className={`px-3 py-2 text-[11px] font-bold uppercase tracking-widest whitespace-nowrap ${tab === "info" ? "bg-stone-900 text-white" : "text-stone-500"}`}
          >
            Info
          </button>
        </div>

        {tab === "explore" ? <ExploreView /> : tab === "college" ? <CollegeView /> : tab === "drating" ? <DRatingView /> : tab === "shotzones" ? <ShotZonesView /> : tab === "info" ? <InfoView /> : <HistoryView season={tab} />}
      </div>
    </div>
  );
}
