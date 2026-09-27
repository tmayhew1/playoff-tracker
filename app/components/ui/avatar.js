"use client";

import { useState } from "react";
import { contrastRatio, fromOklab, teamAltColor, teamColor, toOklab } from "../../lib/format";

// A player's mini avatar: a team-colored disc with his initials, and — where
// the NBA's own player id is known (last night's lines) — his headshot on top,
// falling back to the monogram if the image doesn't load. The data carries no
// photos for the other 46 seasons, and the monogram is what keeps a 1986
// Celtic and a 2026 Thunder rookie looking like the same app.

const SUFFIX = /^(jr\.?|sr\.?|ii|iii|iv|v)$/i;

export function initials(name) {
  const parts = (name || "").split(/\s+/).filter((w) => w && !SUFFIX.test(w));
  if (!parts.length) return "?";
  const first = parts[0][0] || "";
  const last = parts.length > 1 ? parts[parts.length - 1][0] : "";
  return (first + last).toUpperCase();
}

const darken = (hex, by) => {
  const [L, A, B] = toOklab(hex);
  return fromOklab([Math.max(0, L - by), A, B]);
};

// Multi-team rows ("2TM") and unknown teams get a neutral stone disc.
const isTeam = (t) => t && !/^(TOT|\dTM)$/.test(t);

export function PlayerAvatar({ name, team, size = 32, personId = null, ring = true, className = "" }) {
  const [photoOk, setPhotoOk] = useState(!!personId);
  const base = isTeam(team) ? teamColor(team) : "#a8a29e";
  const alt = (isTeam(team) && teamAltColor(team)) || "#ffffff";
  const ink = contrastRatio("#ffffff", base) >= 2.6 ? "#ffffff" : "#1c1917";
  const style = {
    width: size,
    height: size,
    background: `radial-gradient(120% 120% at 25% 15%, ${base} 0%, ${darken(base, 0.12)} 70%)`,
    color: ink,
    fontSize: Math.round(size * 0.38),
    boxShadow: ring
      ? `0 0 0 ${size >= 40 ? 2.5 : 1.5}px #fff, 0 0 0 ${size >= 40 ? 4 : 2.5}px ${alt}`
      : undefined,
  };
  return (
    <span
      className={`relative inline-flex items-center justify-center rounded-full overflow-hidden shrink-0 font-bold tracking-tight select-none ${className}`}
      style={style}
      aria-hidden
    >
      <span style={{ letterSpacing: "-0.02em" }}>{initials(name)}</span>
      {photoOk && personId && (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={`https://cdn.nba.com/headshots/nba/latest/260x190/${personId}.png`}
          alt=""
          loading="lazy"
          onError={() => setPhotoOk(false)}
          className="absolute inset-0 w-full h-full object-cover object-top"
          style={{ transform: "scale(1.35) translateY(12%)" }}
        />
      )}
    </span>
  );
}
